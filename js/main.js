import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://vlntfwtytijdyokndkqf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mkY0QP5g7HLgf-cevvcoBA_MEj8EIsX';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isSignUpMode = false;
let currentUser = null;
let currentProfile = null;

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initAuthListeners();
  initProfileEditListeners();
  initCreatePostListeners();
  initPostInteractionListeners();
  checkSession();
  loadFeed(); // 就算沒登入也直接載入動態牆
});

// 時間格式化工具函式
function formatTimeAgo(dateString) {
  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now.getTime() - past.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return '剛剛';
  } else if (diffMin < 60) {
    return `${diffMin}分鐘前`;
  } else if (diffHour < 24) {
    return `${diffHour}小時前`;
  } else {
    return `${diffDay}天前`;
  }
}

function initCreatePostListeners() {
  const modal = document.getElementById('create-post-modal');
  const btnOpen = document.getElementById('btn-create-post');
  const btnClose = document.getElementById('btn-close-post-modal');
  const postForm = document.getElementById('create-post-form');
  const contentInput = document.getElementById('post-content-input');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      if (!currentUser) {
        // 未登入時改為彈出登入框，而不是單純 alert
        showLoginModal();
        return;
      }
      modal.classList.remove('hidden');
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  if (postForm) {
    postForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = contentInput.value.trim();
      if (!content || !currentUser) return;

      const { data, error } = await supabase
        .from('posts')
        .insert([{ user_id: currentUser.id, content: content }])
        .select();

      if (error) {
        alert('發布失敗：' + error.message);
        return;
      }

      contentInput.value = '';
      modal.classList.add('hidden');
      alert('膠囊貼文發布成功！');
      
      loadFeed();
      if (currentProfile) loadUserPosts(currentProfile.id);
    });
  }
}

// 結合 profiles 手動抓取作者資料與時間格式化顯示
async function loadFeed() {
  const container = document.getElementById('posts-container');
  if (!container) return;
  
  // 1. 取得所有貼文
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    container.innerHTML = `<div class="text-center text-muted py-8">載入貼文失敗: ${error.message}</div>`;
    return;
  }

  if (!posts || posts.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-8">目前還沒有膠囊貼文，快登入發布第一個吧！</div>`;
    return;
  }

  // 2. 收集所有不重複的 user_id
  const userIds = [...new Set(posts.map(p => p.user_id))];

  // 3. 批次查詢對應的 profiles 資料
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .in('id', userIds);

  const profileMap = new Map();
  if (profiles) {
    profiles.forEach(p => profileMap.set(p.id, p));
  }

  const interactions = await loadPostInteractions(posts, profileMap);
  container.innerHTML = posts.map(post => renderPostCard(post, profileMap.get(post.user_id) || {}, interactions)).join('');
}

function initNavigation() {
  const navHome = document.getElementById('nav-home');
  const navProfile = document.getElementById('nav-profile');
  
  if (navHome) {
    navHome.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  if (navProfile) {
    navProfile.addEventListener('click', () => {
      if (!currentUser) {
        // 如果在個人檔案頁點擊時未登入，才跳出登入框
        showLoginModal();
        return;
      }
      window.location.href = 'profile.html';
    });
  }
}

function initAuthListeners() {
  const modal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const onboardingForm = document.getElementById('onboarding-form');
  const toggleBtn = document.getElementById('btn-toggle-auth-mode');
  const googleBtn = document.getElementById('btn-google-login');

  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (error) alert(error.message);
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isSignUpMode = !isSignUpMode;
      document.getElementById('btn-auth-submit').textContent = isSignUpMode ? '確認註冊' : '確認登入';
      document.getElementById('auth-switch-text').textContent = isSignUpMode ? '已有帳號？' : '還沒有帳號？';
      toggleBtn.textContent = isSignUpMode ? '立即登入' : '立即註冊';
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;

      if (isSignUpMode) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) alert(error.message);
        else alert('註冊成功！請驗證 Email 或直接登入。');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
      }
    });
  }

  if (onboardingForm) {
    onboardingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = document.getElementById('setup-display-name').value;
      const username = document.getElementById('setup-username').value;

      if (!currentUser) return;

      const { error } = await supabase.from('profiles').upsert({
        id: currentUser.id,
        display_name: displayName,
        username: username,
        updated_at: new Date().toISOString()
      });

      if (error) {
        alert('該 ID 已被使用或儲存失敗：' + error.message);
        return;
      }

      modal.classList.add('hidden');
      currentProfile = { id: currentUser.id, display_name: displayName, username: username };
      renderUserProfile(currentProfile);
      renderProfilePage(currentProfile);
      loadFeed();
    });
  }

  // 監聽登入狀態改變，但不主動在沒登入時跳窗
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await handleUserAuthSuccess(session.user);
    } else {
      currentUser = null;
      currentProfile = null;
      renderGuestState(); // 顯示訪客狀態
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

function initProfileEditListeners() {
  const editModal = document.getElementById('edit-profile-modal');
  const btnEdit = document.getElementById('btn-edit-profile');
  const btnClose = document.getElementById('btn-close-edit-modal');
  const editForm = document.getElementById('edit-profile-form');
  const limitHintEl = document.getElementById('edit-limit-hint');

  if (!btnEdit) return;

  btnEdit.addEventListener('click', () => {
    if (!currentProfile) return;
    document.getElementById('edit-display-name').value = currentProfile.display_name || '';
    document.getElementById('edit-username').value = currentProfile.username || '';
    
    const now = new Date();
    const lastUpdated = currentProfile.updated_at ? new Date(currentProfile.updated_at) : null;
    let changeCount = currentProfile.change_count || 0;
    
    if (lastUpdated) {
      const diffDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
      if (diffDays >= 14) {
        changeCount = 0;
      }
    }
    const remaining = Math.max(0, 2 - changeCount);
    if (limitHintEl) {
      limitHintEl.textContent = `14 天內僅能修改 2 次暱稱與 ID（目前 14 天內已修改 ${changeCount} 次，剩餘 ${remaining} 次額度）`;
    }

    editModal.classList.remove('hidden');
  });

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      editModal.classList.add('hidden');
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = document.getElementById('edit-display-name').value;
      const newUsername = document.getElementById('edit-username').value;
      const avatarFileInput = document.getElementById('edit-avatar-file');
      const avatarFile = avatarFileInput ? avatarFileInput.files[0] : null;

      const now = new Date();
      const lastUpdated = currentProfile.updated_at ? new Date(currentProfile.updated_at) : null;
      let changeCount = currentProfile.change_count || 0;

      if (lastUpdated) {
        const diffDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);
        if (diffDays < 14 && changeCount >= 2) {
          alert('14 天內最多只能修改 2 次暱稱或 ID，請於期限後再試。');
          return;
        }
        if (diffDays >= 14) {
          changeCount = 0;
        }
      }

      let isNameOrIdChanged = (newName !== currentProfile.display_name || newUsername !== currentProfile.username);
      if (isNameOrIdChanged) {
        const confirmChange = confirm(`14 天內僅能修改 2 次資料（目前已修改 ${changeCount} 次）。確定要更新嗎？`);
        if (!confirmChange) return;
        changeCount += 1;
      }

      let avatarUrl = currentProfile.avatar_url;
      if (avatarFile) {
        try {
          avatarUrl = await fileToBase64(avatarFile);
        } catch (err) {
          alert('頭像讀取失敗');
          return;
        }
      }

      const { error } = await supabase.from('profiles').upsert({
        id: currentUser.id,
        display_name: newName,
        username: newUsername,
        avatar_url: avatarUrl,
        change_count: changeCount,
        updated_at: now.toISOString()
      });

      if (error) {
        alert('更新失敗：' + error.message);
        return;
      }

      currentProfile.display_name = newName;
      currentProfile.username = newUsername;
      currentProfile.avatar_url = avatarUrl;
      currentProfile.change_count = changeCount;
      currentProfile.updated_at = now.toISOString();

      renderUserProfile(currentProfile);
      renderProfilePage(currentProfile);
      editModal.classList.add('hidden');
      alert('個人檔案更新成功！');
    });
  }
}

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await handleUserAuthSuccess(session.user);
  } else {
    // 沒登入時只把登入視窗隱藏，讓使用者能順暢瀏覽
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
    renderGuestState();
  }
}

async function handleUserAuthSuccess(user) {
  const modal = document.getElementById('auth-modal');
  const loginStep = document.getElementById('auth-step-login');
  const onboardingStep = document.getElementById('auth-step-onboarding');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.username) {
    if (loginStep) loginStep.classList.add('hidden');
    if (onboardingStep) onboardingStep.classList.remove('hidden');
    if (modal) modal.classList.remove('hidden');
  } else {
    if (modal) modal.classList.add('hidden');
    currentProfile = profile;
    renderUserProfile(profile);
    renderProfilePage(profile);
    loadFeed();
  }
}

function showLoginModal() {
  const modal = document.getElementById('auth-modal');
  const loginStep = document.getElementById('auth-step-login');
  const onboardingStep = document.getElementById('auth-step-onboarding');

  if (loginStep) loginStep.classList.remove('hidden');
  if (onboardingStep) onboardingStep.classList.add('hidden');
  if (modal) modal.classList.remove('hidden');
}

// 訪客未登入時介面顯示
function renderGuestState() {
  const nameEl = document.getElementById('current-user-name');
  const handleEl = document.getElementById('current-user-handle');
  
  if (nameEl) {
    nameEl.innerHTML = `<button id="btn-quick-login" class="btn-link" style="padding:0; font-size:inherit;">點此登入</button>`;
    document.getElementById('btn-quick-login')?.addEventListener('click', showLoginModal);
  }
  if (handleEl) handleEl.textContent = '@guest';
}

function applyAvatarStyle(el, profile, shortAvatar) {
  if (!el) return;
  if (profile && profile.avatar_url) {
    el.style.backgroundImage = `url(${profile.avatar_url})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = 'none';
    el.textContent = shortAvatar || '--';
  }
}

function renderUserProfile(profile) {
  const nameEl = document.getElementById('current-user-name');
  const handleEl = document.getElementById('current-user-handle');
  const avatarEl = document.getElementById('widget-avatar');
  const storyAvatar = document.getElementById('story-my-avatar');

  const name = profile.display_name || '使用者';
  const handle = `@${profile.username}`;
  const shortAvatar = name.slice(0, 2).toUpperCase();

  if (nameEl) nameEl.textContent = name;
  if (handleEl) handleEl.textContent = handle;
  applyAvatarStyle(avatarEl, profile, shortAvatar);
  applyAvatarStyle(storyAvatar, profile, shortAvatar);

  let logoutBtn = document.getElementById('btn-logout');
  if (!logoutBtn) {
    logoutBtn = document.createElement('button');
    logoutBtn.id = 'btn-logout';
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = '登出';
    logoutBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (currentUser) {
        await supabase.auth.signOut();
        window.location.reload();
      } else {
        showLoginModal();
      }
    });
    const profileInfo = document.querySelector('#widget-profile .profile-info');
    if (profileInfo) profileInfo.appendChild(logoutBtn);
  }
}

function renderProfilePage(profile) {
  if (!profile) return;
  const nameEl = document.getElementById('profile-page-name');
  const handleEl = document.getElementById('profile-page-handle');
  const avatarEl = document.getElementById('profile-page-avatar');

  const name = profile.display_name || '使用者';
  const handle = `@${profile.username}`;
  const shortAvatar = name.slice(0, 2).toUpperCase();

  if (nameEl) nameEl.textContent = name;
  if (handleEl) handleEl.textContent = handle;
  applyAvatarStyle(avatarEl, profile, shortAvatar);

  loadUserPosts(profile.id);
}

// 個人檔案頁面：加入時間格式化顯示
async function loadUserPosts(userId) {
  const container = document.getElementById('user-posts-container');
  if (!container) return;
  
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: false });

  if (error || !posts || posts.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-8">尚未發布任何膠囊貼文</div>`;
    return;
  }

  const profileMap = new Map();
  if (currentProfile) profileMap.set(currentProfile.id, currentProfile);
  const interactions = await loadPostInteractions(posts, profileMap);
  container.innerHTML = posts.map(post => renderPostCard(post, currentProfile || {}, interactions)).join('');
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function loadPostInteractions(posts, profileMap) {
  const likesByPost = new Map();
  const commentsByPost = new Map();
  if (!posts.length) return { likesByPost, commentsByPost, profileMap };

  const postIds = posts.map(post => post.id);
  const [likesResult, commentsResult] = await Promise.all([
    supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
    supabase.from('post_comments').select('id, post_id, user_id, content, created_at').in('post_id', postIds).order('created_at', { ascending: true })
  ]);

  if (likesResult.error) console.error('載入按讚失敗：', likesResult.error.message);
  (likesResult.data || []).forEach(like => {
    const likes = likesByPost.get(like.post_id) || [];
    likes.push(like);
    likesByPost.set(like.post_id, likes);
  });

  const comments = commentsResult.data || [];
  if (commentsResult.error) console.error('載入留言失敗：', commentsResult.error.message);
  const commenterIds = [...new Set(comments.map(comment => comment.user_id).filter(Boolean))];
  if (commenterIds.length) {
    const { data: commenterProfiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', commenterIds);
    if (error) console.error('載入留言者資料失敗：', error.message);
    (commenterProfiles || []).forEach(profile => profileMap.set(profile.id, profile));
  }

  comments.forEach(comment => {
    const postComments = commentsByPost.get(comment.post_id) || [];
    postComments.push(comment);
    commentsByPost.set(comment.post_id, postComments);
  });

  return { likesByPost, commentsByPost, profileMap };
}

function renderPostCard(post, profile, interactions) {
  const name = escapeHTML(profile.display_name || '匿名使用者');
  const username = profile.username ? `@${escapeHTML(profile.username)}` : '';
  const shortAvatar = name.slice(0, 2).toUpperCase();
  const avatarUrl = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(profile.avatar_url || '')
    ? profile.avatar_url
    : '';
  const likes = interactions.likesByPost.get(post.id) || [];
  const liked = currentUser && likes.some(like => like.user_id === currentUser.id);
  const comments = interactions.commentsByPost.get(post.id) || [];

  return `
    <article class="post-card liquid-glass-bar" data-post-id="${escapeHTML(post.id)}">
      <header class="post-header">
        <div class="user-info">
          <div class="avatar post-author-avatar">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="" />` : shortAvatar}</div>
          <div>
            <h4 class="username">${name} <small class="text-muted" style="font-weight: normal; font-size: 0.8rem;">${username}</small></h4>
            <span class="post-time">${escapeHTML(formatTimeAgo(post.created_at))}</span>
          </div>
        </div>
      </header>
      <div class="post-caption">${escapeHTML(post.content || '')}</div>
      <div class="post-actions">
        <button type="button" class="post-action${liked ? ' is-liked' : ''}" data-action="like" aria-pressed="${Boolean(liked)}">
          <span class="material-symbols-outlined">favorite</span>
          <span>${likes.length}</span>
          <span>按讚</span>
        </button>
        <span class="post-comment-count">${comments.length} 則留言</span>
      </div>
      <div class="post-comments">
        ${comments.map(comment => {
          const commenter = interactions.profileMap.get(comment.user_id) || {};
          return `<div class="post-comment"><strong>${escapeHTML(commenter.display_name || '匿名使用者')}</strong><span>${escapeHTML(comment.content)}</span></div>`;
        }).join('')}
        <form class="comment-form" data-action="comment">
          <input type="text" name="content" maxlength="1000" placeholder="寫下留言..." aria-label="留言內容" required />
          <button type="submit" class="btn-comment">送出</button>
        </form>
      </div>
    </article>
  `;
}

function initPostInteractionListeners() {
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action="like"]');
    if (!button) return;
    if (!currentUser) {
      showLoginModal();
      return;
    }

    const postId = button.closest('[data-post-id]').dataset.postId;
    const { data: existingLike, error: lookupError } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (lookupError) {
      alert('讀取按讚狀態失敗：' + lookupError.message);
      return;
    }

    const result = existingLike
      ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      : await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
    if (result.error) {
      alert('更新按讚失敗：' + result.error.message);
      return;
    }
    refreshPostLists();
  });

  document.addEventListener('submit', async event => {
    const form = event.target.closest('.comment-form');
    if (!form) return;
    event.preventDefault();
    if (!currentUser) {
      showLoginModal();
      return;
    }

    const content = String(new FormData(form).get('content') || '').trim();
    if (!content) return;
    const postId = form.closest('[data-post-id]').dataset.postId;
    const { error } = await supabase.from('post_comments').insert({
      post_id: postId,
      user_id: currentUser.id,
      content
    });
    if (error) {
      alert('留言失敗：' + error.message);
      return;
    }
    refreshPostLists();
  });
}

function refreshPostLists() {
  if (document.getElementById('posts-container')) loadFeed();
  if (currentProfile && document.getElementById('user-posts-container')) loadUserPosts(currentProfile.id);
}