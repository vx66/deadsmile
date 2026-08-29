const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const authenticated = ref(false);
    const loginUser = ref('');
    const loginPass = ref('');
    const loginError = ref('');
    
    const currentView = ref('articles');
    const articles = ref([]);
    const categories = ref([]);
    
    const showArticleModal = ref(false);
    const showCategoryModal = ref(false);
    const editingArticle = ref(null);
    const editingCategory = ref(null);
    const editorTab = ref('write');
    
    const articleForm = ref({
      title: '',
      subtitle: '',
      excerpt: '',
      content: '',
      category_id: '',
      image: null,
      date: new Date().toISOString().split('T')[0]
    });

    const media = ref([]);
    const uploadMessage = ref('');
    
    const categoryForm = ref({
      name: '',
      visible: true
    });

    const aboutForm = ref({
      content: ''
    });
    const aboutTab = ref('write');

    // Markdown renderer
    const renderedContent = computed(() => {
      if (articleForm.value.content) {
        return marked.parse(articleForm.value.content);
      }
      return '<p class="preview-empty">Nothing to preview</p>';
    });

    const renderedAbout = computed(() => {
      if (aboutForm.value.content) {
        return marked.parse(aboutForm.value.content);
      }
      return '<p class="preview-empty">Nothing to preview</p>';
    });

    // Check auth status
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth');
        const data = await response.json();
        authenticated.value = data.authenticated;
        if (authenticated.value) {
          fetchArticles();
          fetchCategories();
          fetchAbout();
          fetchMedia();
        }
      } catch (e) {
        authenticated.value = false;
      }
    };

    // Login
    const login = async () => {
      loginError.value = '';
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginUser.value, password: loginPass.value })
        });
        const data = await response.json();
        if (data.success) {
          authenticated.value = true;
          loginUser.value = '';
          loginPass.value = '';
          fetchArticles();
          fetchCategories();
          fetchAbout();
          fetchMedia();
        } else {
          loginError.value = data.error || 'Invalid credentials';
        }
      } catch (e) {
        loginError.value = 'Connection error';
      }
    };

    // Logout
    const logout = async () => {
      await fetch('/api/logout', { method: 'POST' });
      authenticated.value = false;
    };

    // Fetch articles
    const fetchArticles = async () => {
      const response = await fetch('/api/articles');
      if (response.status === 401) {
        authenticated.value = false;
        return;
      }
      articles.value = await response.json();
    };

    // Fetch categories
    const fetchCategories = async () => {
      const response = await fetch('/api/categories');
      if (response.status === 401) {
        authenticated.value = false;
        return;
      }
      categories.value = await response.json();
    };

    // Article CRUD
    const openArticleModal = (article = null) => {
      editorTab.value = 'write';
      editingArticle.value = article;
      if (article) {
        articleForm.value = {
          title: article.title,
          subtitle: article.subtitle,
          excerpt: article.excerpt || '',
          content: article.content,
          category_id: article.category_id || '',
          image: article.image,
          date: article.date || new Date().toISOString().split('T')[0]
        };
      } else {
        articleForm.value = {
          title: '',
          subtitle: '',
          excerpt: '',
          content: '',
          category_id: '',
          image: null,
          date: new Date().toISOString().split('T')[0]
        };
      }
      showArticleModal.value = true;
    };

    const closeArticleModal = () => {
      showArticleModal.value = false;
      editingArticle.value = null;
    };

    const handleImageUpload = (event) => {
      const file = event.target.files[0];
      if (file) {
        const formData = new FormData();
        formData.append('image', file);
        
        fetch('/api/upload', {
          method: 'POST',
          body: formData
        })
        .then(res => res.json())
        .then(data => {
          articleForm.value.image = data.filename;
        });
      }
    };

    const saveArticle = async () => {
      const formData = new FormData();
      formData.append('title', articleForm.value.title);
      formData.append('subtitle', articleForm.value.subtitle);
      formData.append('excerpt', articleForm.value.excerpt);
      formData.append('content', articleForm.value.content);
      formData.append('category_id', articleForm.value.category_id);
      formData.append('date', articleForm.value.date);
      
      if (articleForm.value.image && typeof articleForm.value.image === 'string') {
        formData.append('existing_image', articleForm.value.image);
      }

      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput && fileInput.files[0]) {
        formData.append('image', fileInput.files[0]);
      }

      const url = editingArticle.value 
        ? `/api/articles/${editingArticle.value.id}`
        : '/api/articles';
      
      const method = editingArticle.value ? 'PUT' : 'POST';

      await fetch(url, {
        method: method,
        body: formData
      });

      closeArticleModal();
      fetchArticles();
    };

    const editArticle = (article) => {
      openArticleModal(article);
    };

    const deleteArticle = async (id) => {
      if (confirm('Delete this article?')) {
        await fetch(`/api/articles/${id}`, { method: 'DELETE' });
        fetchArticles();
      }
    };

    // Category CRUD
    const openCategoryModal = (category = null) => {
      editingCategory.value = category;
      if (category) {
        categoryForm.value = { name: category.name, visible: !!category.visible };
      } else {
        categoryForm.value = { name: '', visible: true };
      }
      showCategoryModal.value = true;
    };

    const closeCategoryModal = () => {
      showCategoryModal.value = false;
      editingCategory.value = null;
    };

    const saveCategory = async () => {
      const url = editingCategory.value
        ? `/api/categories/${editingCategory.value.id}`
        : '/api/categories';
      
      const method = editingCategory.value ? 'PUT' : 'POST';

      await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categoryForm.value.name,
          visible: categoryForm.value.visible ? 1 : 0
        })
      });

      closeCategoryModal();
      fetchCategories();
    };

    const toggleCategoryVis = async (category) => {
      await fetch(`/api/categories/${category.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: category.name, visible: category.visible ? 0 : 1 })
      });
      fetchCategories();
    };

    const editCategory = (category) => {
      openCategoryModal(category);
    };

    const deleteCategory = async (id) => {
      if (confirm('Delete this category?')) {
        await fetch(`/api/categories/${id}`, { method: 'DELETE' });
        fetchCategories();
      }
    };

    // About CRUD
    const fetchAbout = async () => {
      const response = await fetch('/api/about');
      if (response.status === 401) {
        authenticated.value = false;
        return;
      }
      const data = await response.json();
      aboutForm.value.content = data.content || '';
    };

    const saveAbout = async () => {
      await fetch('/api/about', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: aboutForm.value.content })
      });
      aboutTab.value = 'preview';
    };

    // Media library
    const isImage = (filename) => /\.(jpe?g|png|gif|webp|svg)$/i.test(filename);
    const isVideo = (filename) => /\.(mp4|webm)$/i.test(filename);
    const isAudio = (filename) => /\.(mp3|wav|ogg|m4a)$/i.test(filename);

    const formatSize = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const fetchMedia = async () => {
      const response = await fetch('/api/uploads');
      if (response.status === 401) {
        authenticated.value = false;
        return;
      }
      media.value = await response.json();
    };

    const uploadMedia = async (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      uploadMessage.value = 'Uploading...';
      let uploaded = 0;
      for (const file of files) {
        const formData = new FormData();
        formData.append('image', file);
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (response.ok) uploaded++;
      }
      uploadMessage.value = uploaded > 0
        ? `Uploaded ${uploaded} file${uploaded > 1 ? 's' : ''}.`
        : 'Upload failed.';
      event.target.value = '';
      setTimeout(() => { uploadMessage.value = ''; }, 2500);
      fetchMedia();
    };

    const copyText = async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      }
    };

    const copyMarkdown = async (item) => {
      const ok = await copyText(item.markdown);
      uploadMessage.value = ok ? 'Markdown copied!' : 'Copy failed';
      setTimeout(() => { uploadMessage.value = ''; }, 2000);
    };

    const copyUrl = async (item) => {
      const ok = await copyText(item.url);
      uploadMessage.value = ok ? 'URL copied!' : 'Copy failed';
      setTimeout(() => { uploadMessage.value = ''; }, 2000);
    };

    const deleteMedia = async (item) => {
      if (confirm('Delete this file?')) {
        await fetch('/api/uploads/' + encodeURIComponent(item.filename), { method: 'DELETE' });
        fetchMedia();
      }
    };

    // Initialize
    onMounted(() => {
      checkAuth();
    });

    return {
      authenticated,
      loginUser,
      loginPass,
      loginError,
      login,
      logout,
      currentView,
      articles,
      categories,
      showArticleModal,
      showCategoryModal,
      editingArticle,
      editingCategory,
      articleForm,
      categoryForm,
      aboutForm,
      aboutTab,
      media,
      uploadMessage,
      fetchAbout,
      fetchMedia,
      uploadMedia,
      isImage,
      isVideo,
      isAudio,
      formatSize,
      copyMarkdown,
      copyUrl,
      deleteMedia,
      editorTab,
      renderedContent,
      renderedAbout,
      saveAbout,
      fetchAbout,
      openArticleModal,
      closeArticleModal,
      handleImageUpload,
      saveArticle,
      editArticle,
      deleteArticle,
      openCategoryModal,
      closeCategoryModal,
      saveCategory,
      editCategory,
      deleteCategory,
      toggleCategoryVis
    };
  }
}).mount('#app');