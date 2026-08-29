const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Database setup - use data directory for persistence
const dbFile = path.join(dataDir, 'database.db');

// Safety backup: keep last known-good DB before opening this session
if (fs.existsSync(dbFile)) {
  try {
    fs.copyFileSync(dbFile, path.join(dataDir, 'database.backup.db'));
  } catch (e) {
    console.error('[backup] No se pudo copiar database.db a database.backup.db:', e.message);
  }
}

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    visible INTEGER DEFAULT 1,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT,
    excerpt TEXT,
    content TEXT,
    category_id INTEGER,
    image TEXT,
    date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS about (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add columns if missing
try { db.exec("ALTER TABLE articles ADD COLUMN date TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE articles ADD COLUMN excerpt TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE categories ADD COLUMN visible INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE categories ADD COLUMN position INTEGER DEFAULT 0"); } catch(e) {}

// Insert default categories if empty
const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
if (categoryCount.count === 0) {
  const insertCategory = db.prepare('INSERT INTO categories (name, slug, visible, position) VALUES (?, ?, 1, ?)');
  insertCategory.run('ARTICLES', 'articles', 0);
  insertCategory.run('PROJECTS', 'projects', 1);
  insertCategory.run('BLOG', 'blog', 2);
}

// Insert default about content if empty
const aboutCount = db.prepare('SELECT COUNT(*) as count FROM about').get();
if (aboutCount.count === 0) {
  db.prepare('INSERT INTO about (id, content) VALUES (1, ?)').run(
    '# Who is Xergno\n\nInvestigador de sistemas, arquitectura de señales y preservación de tecnología olvidada.\n\n> Operando entre la ingeniería y el ruido.\n\nEste laboratorio documenta experimentos, análisis y reconstrucción de sistemas.'
  );
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'deadsmile-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

// Login credentials
const USERS = {
  xergno: 'simbionte666'
};

// Login route
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Logout route
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Static files - preserve existing design
app.use('/img', express.static(path.join(__dirname, 'img')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));

// Serve Vue dashboard from public folder
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg|mp4|webm|ogg|mp3|wav/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /^(image|video|audio)\//.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image, video and audio files are allowed'));
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public articles endpoint (no auth required)
app.get('/api/articles/public', (req, res) => {
  const { category } = req.query;
  let sql = `
    SELECT a.id, a.title, a.subtitle, a.excerpt, a.content, a.image, a.date, a.created_at,
           c.name as category_name, c.slug as category_slug 
    FROM articles a 
    LEFT JOIN categories c ON a.category_id = c.id 
  `;
  const params = [];
  if (category) {
    sql += ' WHERE c.slug = ?';
    params.push(category);
  }
  sql += ' ORDER BY a.date DESC, a.created_at DESC';
  const articles = db.prepare(sql).all(...params);
  res.json(articles);
});

// Public categories for menu (visible only, ordered)
app.get('/api/categories/public', (req, res) => {
  const categories = db.prepare('SELECT id, name, slug FROM categories WHERE visible = 1 ORDER BY position ASC, id ASC').all();
  res.json(categories);
});

// Public single article endpoint
app.get('/api/articles/public/:id', (req, res) => {
  const article = db.prepare(`
    SELECT a.id, a.title, a.subtitle, a.excerpt, a.content, a.image, a.date, a.created_at,
           c.name as category_name, c.slug as category_slug 
    FROM articles a 
    LEFT JOIN categories c ON a.category_id = c.id 
    WHERE a.id = ?
  `).get(req.params.id);
  
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  res.json(article);
});

// Public about page endpoint
app.get('/api/about', (req, res) => {
  const about = db.prepare('SELECT content, updated_at FROM about WHERE id = 1').get();
  if (!about) {
    return res.json({ content: '', updated_at: null });
  }
  res.json(about);
});

// API Routes (protected)

// Get all articles
app.get('/api/articles', requireAuth, (req, res) => {
  const articles = db.prepare(`
    SELECT a.*, c.name as category_name, c.slug as category_slug 
    FROM articles a 
    LEFT JOIN categories c ON a.category_id = c.id 
    ORDER BY a.created_at DESC
  `).all();
  res.json(articles);
});

// Get single article
app.get('/api/articles/:id', requireAuth, (req, res) => {
  const article = db.prepare(`
    SELECT a.*, c.name as category_name, c.slug as category_slug 
    FROM articles a 
    LEFT JOIN categories c ON a.category_id = c.id 
    WHERE a.id = ?
  `).get(req.params.id);
  
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  res.json(article);
});

// Create article
app.post('/api/articles', requireAuth, upload.single('image'), (req, res) => {
  const { title, subtitle, excerpt, content, category_id, date } = req.body;
  const image = req.file ? req.file.filename : null;
  const articleDate = date || new Date().toISOString().split('T')[0];
  
  const result = db.prepare(`
    INSERT INTO articles (title, subtitle, excerpt, content, category_id, image, date) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, subtitle, excerpt, content, category_id, image, articleDate);
  
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(article);
});

// Update article
app.put('/api/articles/:id', requireAuth, upload.single('image'), (req, res) => {
  const { title, subtitle, excerpt, content, category_id, date } = req.body;
  const image = req.file ? req.file.filename : req.body.existing_image;
  const articleDate = date || new Date().toISOString().split('T')[0];
  
  db.prepare(`
    UPDATE articles 
    SET title = ?, subtitle = ?, excerpt = ?, content = ?, category_id = ?, image = ?, date = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(title, subtitle, excerpt, content, category_id, image, articleDate, req.params.id);
  
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  res.json(article);
});

// Delete article
app.delete('/api/articles/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(req.params.id);
  res.json({ message: 'Article deleted' });
});

// Get all categories
app.get('/api/categories', requireAuth, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY position ASC, id ASC').all();
  res.json(categories);
});

// Create category
app.post('/api/categories', requireAuth, (req, res) => {
  const { name } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const nextPosition = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 as pos FROM categories').get().pos;
  
  const result = db.prepare('INSERT INTO categories (name, slug, visible, position) VALUES (?, ?, 1, ?)').run(name, slug, nextPosition);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(category);
});

// Update category
app.put('/api/categories/:id', requireAuth, (req, res) => {
  const { name, visible, position } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  
  db.prepare('UPDATE categories SET name = ?, slug = ?, visible = ?, position = ? WHERE id = ?')
    .run(name, slug, visible !== undefined ? (visible ? 1 : 0) : 1, position !== undefined ? position : 0, req.params.id);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(category);
});

// Update about page
app.put('/api/about', requireAuth, (req, res) => {
  const { content } = req.body;
  db.prepare(`
    INSERT INTO about (id, content, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `).run(content || '');
  const about = db.prepare('SELECT content, updated_at FROM about WHERE id = 1').get();
  res.json(about);
});

// Delete category
app.delete('/api/categories/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ message: 'Category deleted' });
});

// Upload image / media
app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filename: req.file.filename, path: `/uploads/${req.file.filename}` });
});

// List uploaded media
app.get('/api/uploads', requireAuth, (req, res) => {
  const files = fs.readdirSync(uploadsDir)
    .filter(f => f !== '.gitkeep')
    .map(f => {
      const stat = fs.statSync(path.join(uploadsDir, f));
      return {
        filename: f,
        url: `/uploads/${f}`,
        markdown: `![${path.parse(f).name}](/uploads/${f})`,
        size: stat.size,
        modified: stat.mtime
      };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(files);
});

// Delete uploaded media
app.delete('/api/uploads/:filename', requireAuth, (req, res) => {
  const fname = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, fname);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ message: 'Deleted' });
});

// Serve public pages (preserve existing design)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/article/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'article.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/category/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'category.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Dead Smile Labs server running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/admin`);
});