import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://vlntfwtytijdyokndkqf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mkY0QP5g7HLgf-cevvcoBA_MEj8EIsX';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let isSignUpMode = false;
let currentUser = null;
let currentProfile = null;
let viewedProfile = null;
let appDialogResolver = null;
let activeMessagePeer = null;
let messageRefreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initAppDialog();
  initNavigation();
  initAuthListeners();
  initProfileEditListeners();
  initCreatePostListeners();
  initCreateMenu();
  initPostInteractionListeners();
  initStickyNoteListeners();
  initMessagesPage();
  checkSession();
  loadFeed(); // 就算沒登入也直接載入動態牆
  loadProfileRoute();
  loadStickyNotes();
  if (new URLSearchParams(window.location.search).get('compose') === 'note') {
    openStickyNoteModal();
  }
});

function initAppDialog() {
  const overlay = document.getElementById('app-dialog');
  const confirmButton = document.getElementById('app-dialog-confirm');
  const cancelButton = document.getElementById('app-dialog-cancel');
  if (!overlay || !confirmButton || !cancelButton) return;

  confirmButton.addEventListener('click', () => closeAppDialog(true));
  cancelButton.addEventListener('click', () => closeAppDialog(false));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeAppDialog(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeAppDialog(false);
    }
  });
}

function showAppDialog(message, options = {}) {
  const overlay = document.getElementById('app-dialog');
  const title = document.getElementById('app-dialog-title');
  const messageElement = document.getElementById('app-dialog-message');
  const confirmButton = document.getElementById('app-dialog-confirm');
  const cancelButton = document.getElementById('app-dialog-cancel');
  if (!overlay || !title || !messageElement || !confirmButton || !cancelButton) {
    console.error('提示視窗元件不存在：', message);
    return Promise.resolve(false);
  }

  if (appDialogResolver) closeAppDialog(false);
  title.textContent = options.title || 'VibeVerse';
  messageElement.textContent = String(message ?? '');
  confirmButton.textContent = options.confirmLabel || (options.confirm ? '確認' : '知道了');
  cancelButton.textContent = options.cancelLabel || '取消';
  cancelButton.classList.toggle('hidden', !options.confirm);
  overlay.dataset.variant = options.variant || (options.confirm ? 'confirm' : 'info');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  confirmButton.focus();

  return new Promise(resolve => {
    appDialogResolver = resolve;
  });
}

function closeAppDialog(result) {
  const overlay = document.getElementById('app-dialog');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  const resolveDialog = appDialogResolver;
  appDialogResolver = null;
  resolveDialog?.(result);
}

function showNotice(message, variant = 'info') {
  return showAppDialog(message, { variant });
}

function showConfirmation(message) {
  return showAppDialog(message, { confirm: true, variant: 'confirm' });
}

function initCreateMenu() {
  const trigger = document.getElementById('btn-create-menu');
  const options = document.getElementById('create-menu-options');
  if (!trigger || !options) return;

  trigger.addEventListener('click', () => {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!isOpen));
    options.classList.toggle('hidden', isOpen);
  });

  options.addEventListener('click', event => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-create-option]')
      : null;
    if (!button) return;
    trigger.setAttribute('aria-expanded', 'false');
    options.classList.add('hidden');

    if (button.dataset.createOption === 'post') {
      const modal = document.getElementById('create-post-modal');
      if (modal) modal.classList.remove('hidden');
      return;
    }
    if (document.getElementById('sticky-note-modal')) {
      openStickyNoteModal();
      return;
    }
    window.location.href = '/messages?compose=note';
  });

  document.addEventListener('click', event => {
    if (event.target instanceof Node && !trigger.contains(event.target) && !options.contains(event.target)) {
      trigger.setAttribute('aria-expanded', 'false');
      options.classList.add('hidden');
    }
  });
}

function openStickyNoteModal() {
  const modal = document.getElementById('sticky-note-modal');
  modal?.classList.remove('hidden');
  document.getElementById('sticky-note-content')?.focus();
}

async function requestMessageApi(path = '', options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('請先登入');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/messages${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '訊息服務暫時無法處理請求');
  return payload;
}

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

function initStickyNoteListeners() {
  const form = document.getElementById('sticky-note-form');
  const input = document.getElementById('sticky-note-content');
  const count = document.getElementById('sticky-note-count');
  document.getElementById('btn-open-sticky-note')?.addEventListener('click', () => {
    if (!currentUser) {
      showLoginModal();
      return;
    }
    openStickyNoteModal();
  });
  document.getElementById('btn-close-sticky-note')?.addEventListener('click', () => {
    document.getElementById('sticky-note-modal')?.classList.add('hidden');
  });
  input?.addEventListener('input', () => {
    if (count) count.textContent = String(input.value.length);
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser) {
      showLoginModal();
      return;
    }

    const content = input?.value.trim() || '';
    if (!content) return;
    const hours = Number(document.getElementById('sticky-note-expiry')?.value || 24);
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('sticky_notes').insert({
      user_id: currentUser.id,
      content,
      expires_at: expiresAt
    });
    if (error) {
      await showNotice('便利貼發布失敗：' + error.message, 'error');
      return;
    }

    form.reset();
    if (count) count.textContent = '0';
    document.getElementById('sticky-note-modal')?.classList.add('hidden');
    await loadStickyNotes();
  });

  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    const deleteButton = target?.closest('[data-action="delete-note"]');
    if (!deleteButton || !currentUser) return;
    const noteId = deleteButton.closest('[data-note-id]')?.getAttribute('data-note-id');
    if (!noteId || !await showConfirmation('確定要移除這張便利貼嗎？')) return;

    const { error } = await supabase.from('sticky_notes').delete().eq('id', noteId);
    if (error) {
      await showNotice('移除便利貼失敗：' + error.message, 'error');
      return;
    }
    loadStickyNotes();
  });
}

async function loadStickyNotes() {
  const container = document.getElementById('sticky-notes-container');
  if (!container) return;

  const { data: notes, error } = await supabase
    .from('sticky_notes')
    .select('id, user_id, content, created_at, expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    container.innerHTML = '<p class="empty-state">便利貼載入失敗，請稍後再試。</p>';
    console.error('載入便利貼失敗：', error.message);
    return;
  }
  if (!notes?.length) {
    container.innerHTML = '<p class="empty-state">這裡還沒有便利貼，貼下你的第一句想法吧。</p>';
    return;
  }

  const userIds = [...new Set(notes.map(note => note.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .in('id', userIds);
  const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));

  container.innerHTML = notes.map(note => {
    const profile = profilesById.get(note.user_id) || {};
    const canDelete = currentUser?.id === note.user_id;
    const expiresAt = new Date(note.expires_at);
    const profileName = escapeHTML(profile.display_name || '匿名使用者');
    const author = profile.username
      ? `<a href="${escapeHTML(profilePath(profile.username))}">${profileName}</a>`
      : profileName;
    return `<article class="sticky-note" data-note-id="${escapeHTML(note.id)}"><div class="sticky-note-topline"><span class="sticky-note-author">${author}</span>${canDelete ? '<button type="button" class="note-delete-button" data-action="delete-note" aria-label="刪除便利貼">×</button>' : ''}</div><p class="sticky-note-content">${escapeHTML(note.content)}</p><footer class="sticky-note-meta"><time datetime="${escapeHTML(note.created_at)}">${escapeHTML(formatTimeAgo(note.created_at))}</time><span>到期 ${escapeHTML(expiresAt.toLocaleString())}</span></footer></article>`;
  }).join('');
}

function initMessagesPage() {
  const searchForm = document.getElementById('message-user-search-form');
  const composeForm = document.getElementById('message-compose-form');
  const refreshButton = document.getElementById('btn-refresh-conversations');
  const loginButton = document.querySelector('[data-open-login]');

  searchForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser) {
      showLoginModal();
      return;
    }
    const username = String(new FormData(searchForm).get('username') || document.getElementById('message-user-search')?.value || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    if (!/^[a-z0-9_]+$/.test(username)) {
      await showNotice('請輸入有效的使用者 ID（小寫英數字與底線）。', 'error');
      return;
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .eq('username', username)
      .maybeSingle();
    if (error || !profile) {
      await showNotice('找不到這個使用者 ID。', 'error');
      return;
    }
    if (profile.id === currentUser.id) {
      await showNotice('這是你自己的 ID，請選擇其他對象。', 'error');
      return;
    }
    openMessageConversation(profile);
  });

  composeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentUser || !activeMessagePeer) return;
    const input = document.getElementById('message-compose-input');
    const content = input?.value.trim() || '';
    if (!content) return;

    try {
      await requestMessageApi('', {
        method: 'POST',
        body: { recipientId: activeMessagePeer.id, content }
      });
    } catch (error) {
      await showNotice('訊息傳送失敗：' + error.message, 'error');
      return;
    }
    input.value = '';
    await loadMessageHistory(activeMessagePeer);
    await loadConversations();
  });

  refreshButton?.addEventListener('click', loadConversations);
  loginButton?.addEventListener('click', showLoginModal);
}

function renderMessagesAuthState() {
  const authRequired = document.getElementById('messages-auth-required');
  const workspace = document.getElementById('messages-workspace');
  if (!authRequired || !workspace) return;
  authRequired.classList.toggle('hidden', Boolean(currentUser));
  workspace.classList.toggle('hidden', !currentUser);
  if (currentUser) loadConversations();
  else if (messageRefreshTimer) {
    window.clearInterval(messageRefreshTimer);
    messageRefreshTimer = null;
  }
}

function openMessageConversation(profile) {
  activeMessagePeer = profile;
  const name = document.getElementById('active-chat-name');
  const handle = document.getElementById('active-chat-handle');
  const avatar = document.getElementById('active-chat-avatar');
  const profileLink = document.getElementById('active-chat-profile-link');
  const composeForm = document.getElementById('message-compose-form');

  if (name) name.textContent = profile.display_name || '使用者';
  if (handle) handle.textContent = `@${profile.username}`;
  if (avatar) {
    avatar.textContent = (profile.display_name || 'VV').slice(0, 2).toUpperCase();
    const avatarUrl = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(profile.avatar_url || '')
      ? profile.avatar_url
      : '';
    avatar.innerHTML = avatarUrl
      ? `<img src="${escapeHTML(avatarUrl)}" alt="" />`
      : escapeHTML((profile.display_name || 'VV').slice(0, 2).toUpperCase());
  }
  if (profileLink) {
    profileLink.href = profilePath(profile.username);
    profileLink.classList.remove('hidden');
  }
  composeForm?.classList.remove('hidden');
  loadMessageHistory(profile);
  loadConversations();

  if (!messageRefreshTimer) {
    messageRefreshTimer = window.setInterval(() => {
      if (activeMessagePeer && currentUser) loadMessageHistory(activeMessagePeer);
    }, 10000);
  }
}

async function loadConversations() {
  const container = document.getElementById('conversations-container');
  if (!container || !currentUser) return;

  let conversations;
  try {
    ({ conversations } = await requestMessageApi());
  } catch (error) {
    container.innerHTML = '<p class="empty-state">無法載入對話，請確認訊息資料表已建立。</p>';
    console.error('載入對話失敗：', error);
    return;
  }
  if (!conversations?.length) {
    container.innerHTML = '<p class="empty-state">尚無對話，輸入對方的 @使用者ID 開始聊天。</p>';
    return;
  }

  const profileMap = new Map(conversations.map(conversation => [conversation.profile.id, conversation.profile]));
  container.innerHTML = conversations.map(conversation => {
    const profile = conversation.profile;
    const latest = conversation.latest_message;
    if (!profile) return '';
    const selected = activeMessagePeer?.id === profile.id ? ' is-active' : '';
    const avatarUrl = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(profile.avatar_url || '')
      ? profile.avatar_url
      : '';
    const avatar = avatarUrl
      ? `<img src="${escapeHTML(avatarUrl)}" alt="" />`
      : escapeHTML((profile.display_name || 'VV').slice(0, 2).toUpperCase());
    return `<button type="button" class="conversation-item${selected}" data-peer-id="${escapeHTML(profile.id)}"><span class="conversation-avatar">${avatar}</span><span class="conversation-copy"><strong>${escapeHTML(profile.display_name || '使用者')}</strong><small>@${escapeHTML(profile.username || '')}</small><span>${escapeHTML(latest.content)}</span></span><time>${escapeHTML(formatTimeAgo(latest.created_at))}</time></button>`;
  }).join('');

  container.querySelectorAll('[data-peer-id]').forEach(button => {
    button.addEventListener('click', () => {
      const profile = profileMap.get(button.getAttribute('data-peer-id'));
      if (profile) openMessageConversation(profile);
    });
  });
}

async function loadMessageHistory(profile) {
  const container = document.getElementById('messages-container');
  if (!container || !currentUser || !profile) return;
  let messages;
  try {
    ({ messages } = await requestMessageApi(`?peerId=${encodeURIComponent(profile.id)}`));
  } catch (error) {
    container.innerHTML = '<div class="chat-empty-state"><p>無法載入這段對話。</p></div>';
    console.error('載入訊息失敗：', error);
    return;
  }
  if (!messages?.length) {
    container.innerHTML = '<div class="chat-empty-state"><span class="material-symbols-outlined">waving_hand</span><p>傳送第一則訊息，開始對話。</p></div>';
    return;
  }

  container.innerHTML = messages.map(message => {
    const mine = message.sender_id === currentUser.id;
    return `<article class="message-bubble${mine ? ' is-mine' : ''}"><p>${escapeHTML(message.content)}</p><time datetime="${escapeHTML(message.created_at)}">${escapeHTML(new Date(message.created_at).toLocaleString())}</time></article>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
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
        await showNotice('發布失敗：' + error.message, 'error');
        return;
      }

      contentInput.value = '';
      modal.classList.add('hidden');
      await showNotice('膠囊貼文發布成功！', 'success');
      
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
  const navMessages = document.getElementById('nav-messages');
  
  if (navHome) {
    navHome.addEventListener('click', () => {
      window.location.href = '/home';
    });
  }

  if (navProfile) {
    navProfile.addEventListener('click', () => {
      if (!currentUser || !currentProfile?.username) {
        showLoginModal();
        return;
      }
      window.location.href = profilePath(currentProfile.username);
    });
  }

  navMessages?.addEventListener('click', () => {
    window.location.href = '/messages';
  });
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
      if (error) await showNotice(error.message, 'error');
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
        if (error) await showNotice(error.message, 'error');
        else await showNotice('註冊成功！請驗證 Email 或直接登入。', 'success');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) await showNotice(error.message, 'error');
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
        await showNotice('該 ID 已被使用或儲存失敗：' + error.message, 'error');
        return;
      }

      modal.classList.add('hidden');
      currentProfile = { id: currentUser.id, display_name: displayName, username: username };
      renderUserProfile(currentProfile);
      loadFeed();
      loadProfileRoute();
      loadStickyNotes();
      renderMessagesAuthState();
    });
  }

  const guestModeBtn = document.getElementById('btn-guest-mode');
  guestModeBtn?.addEventListener('click', async () => {
    if (currentUser) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        await showNotice('切換訪客模式失敗：' + error.message, 'error');
        return;
      }
    }
    modal?.classList.add('hidden');
    renderGuestState();
  });

  // 監聽登入狀態改變，但不主動在沒登入時跳窗
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await handleUserAuthSuccess(session.user);
    } else {
      currentUser = null;
      currentProfile = null;
      modal?.classList.add('hidden');
      renderGuestState(); // 顯示訪客狀態
      renderMessagesAuthState();
      loadStickyNotes();
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
          await showNotice('14 天內最多只能修改 2 次暱稱或 ID，請於期限後再試。', 'error');
          return;
        }
        if (diffDays >= 14) {
          changeCount = 0;
        }
      }

      let isNameOrIdChanged = (newName !== currentProfile.display_name || newUsername !== currentProfile.username);
      if (isNameOrIdChanged) {
        const confirmChange = await showConfirmation(`14 天內僅能修改 2 次資料（目前已修改 ${changeCount} 次）。確定要更新嗎？`);
        if (!confirmChange) return;
        changeCount += 1;
      }

      let avatarUrl = currentProfile.avatar_url;
      if (avatarFile) {
        try {
          avatarUrl = await fileToBase64(avatarFile);
        } catch (err) {
          await showNotice('頭像讀取失敗', 'error');
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
        await showNotice('更新失敗：' + error.message, 'error');
        return;
      }

      currentProfile.display_name = newName;
      currentProfile.username = newUsername;
      currentProfile.avatar_url = avatarUrl;
      currentProfile.change_count = changeCount;
      currentProfile.updated_at = now.toISOString();

      renderUserProfile(currentProfile);
      if (viewedProfile?.id === currentProfile.id) renderProfilePage(currentProfile);
      editModal.classList.add('hidden');
      await showNotice('個人檔案更新成功！', 'success');
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
    renderMessagesAuthState();
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
    renderMessagesAuthState();
  } else {
    if (modal) modal.classList.add('hidden');
    currentProfile = profile;
    renderUserProfile(profile);
    loadFeed();
    loadProfileRoute();
    loadStickyNotes();
    renderMessagesAuthState();
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
  if (avatarEl) avatarEl.href = profilePath(profile.username);
  if (storyAvatar) storyAvatar.href = profilePath(profile.username);

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
  viewedProfile = profile;
  const nameEl = document.getElementById('profile-page-name');
  const handleEl = document.getElementById('profile-page-handle');
  const avatarEl = document.getElementById('profile-page-avatar');
  const editButton = document.getElementById('btn-edit-profile');

  const name = profile.display_name || '使用者';
  const handle = `@${profile.username}`;
  const shortAvatar = name.slice(0, 2).toUpperCase();

  if (nameEl) nameEl.textContent = name;
  if (handleEl) handleEl.textContent = handle;
  applyAvatarStyle(avatarEl, profile, shortAvatar);
  if (avatarEl) avatarEl.href = profilePath(profile.username);
  if (editButton) editButton.classList.toggle('hidden', !currentUser || currentUser.id !== profile.id);

  loadUserPosts(profile.id, profile);
}

// 個人檔案頁面：加入時間格式化顯示
async function loadUserPosts(userId, profile = currentProfile) {
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
  if (profile) profileMap.set(profile.id, profile);
  const interactions = await loadPostInteractions(posts, profileMap);
  container.innerHTML = posts.map(post => renderPostCard(post, profile || {}, interactions)).join('');
}

function profilePath(username) {
  return `/profile/@${encodeURIComponent(username || '')}`;
}

async function loadProfileRoute() {
  const container = document.getElementById('user-posts-container');
  if (!container) return;

  const match = window.location.pathname.match(/^\/profile\/@([^/]+)\/?$/);
  if (!match) {
    renderProfileNotFound();
    return;
  }

  let username;
  try {
    username = decodeURIComponent(match[1]);
  } catch {
    renderProfileNotFound();
    return;
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url, updated_at, change_count')
    .eq('username', username)
    .maybeSingle();

  if (error || !profile) {
    renderProfileNotFound();
    return;
  }

  renderProfilePage(profile);
}

function renderProfileNotFound() {
  document.title = '404 - 找不到個人檔案 | VibeVerse';
  const view = document.getElementById('view-profile');
  if (view) {
    view.innerHTML = '<section class="profile-not-found"><strong>404</strong><h2>找不到這個個人檔案</h2><p>請確認網址中的帳號 ID 是否正確。</p><a class="btn-secondary" href="/home">返回首頁</a></section>';
  }
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
  const repliesByComment = new Map();
  if (!posts.length) return { likesByPost, commentsByPost, repliesByComment, profileMap };

  const postIds = posts.map(post => post.id);
  const [likesResult, commentsResult] = await Promise.all([
    supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
    supabase.from('post_comments').select('id, post_id, user_id, parent_comment_id, content, created_at').in('post_id', postIds).order('created_at', { ascending: true })
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

    if (comment.parent_comment_id) {
      const replies = repliesByComment.get(comment.parent_comment_id) || [];
      replies.push(comment);
      repliesByComment.set(comment.parent_comment_id, replies);
    }
  });

  return { likesByPost, commentsByPost, repliesByComment, profileMap };
}

function renderComment(comment, interactions, isReply = false) {
  const commenter = interactions.profileMap.get(comment.user_id) || {};
  const username = commenter.username || '';
  const isOwner = currentUser?.id === comment.user_id;
  const replies = interactions.repliesByComment.get(comment.id) || [];
  const replyFormId = `reply-form-${comment.id}`;

  return `
    <div class="post-comment-thread${isReply ? ' is-reply' : ''}" data-comment-id="${escapeHTML(comment.id)}">
      <div class="post-comment">
        <strong>${username ? `<a href="${escapeHTML(profilePath(username))}">${escapeHTML(commenter.display_name || '匿名使用者')}</a>` : escapeHTML(commenter.display_name || '匿名使用者')}</strong>
        <span>${escapeHTML(comment.content)}</span>
        <time class="comment-time" datetime="${escapeHTML(comment.created_at)}" title="${escapeHTML(new Date(comment.created_at).toLocaleString())}">${escapeHTML(formatTimeAgo(comment.created_at))}</time>
      </div>
      <div class="comment-tools">
        ${!isReply ? `<button type="button" class="comment-tool" data-action="reply" aria-controls="${replyFormId}">回覆</button>` : ''}
        ${isOwner ? '<button type="button" class="comment-tool is-danger" data-action="delete-comment">刪除</button>' : ''}
      </div>
      ${!isReply ? `<form id="${replyFormId}" class="comment-form reply-form hidden" data-parent-comment-id="${escapeHTML(comment.id)}"><input type="text" name="content" maxlength="1000" placeholder="回覆 ${escapeHTML(username ? `@${username}` : '這則留言')}..." aria-label="回覆留言內容" required /><button type="submit" class="btn-comment">送出</button></form>` : ''}
      ${replies.map(reply => renderComment(reply, interactions, true)).join('')}
    </div>
  `;
}

function renderPostCard(post, profile, interactions) {
  const name = escapeHTML(profile.display_name || '匿名使用者');
  const username = profile.username ? `@${escapeHTML(profile.username)}` : '';
  const profileLink = profile.username ? escapeHTML(profilePath(profile.username)) : '';
  const shortAvatar = name.slice(0, 2).toUpperCase();
  const avatarUrl = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(profile.avatar_url || '')
    ? profile.avatar_url
    : '';
  const likes = interactions.likesByPost.get(post.id) || [];
  const liked = currentUser && likes.some(like => like.user_id === currentUser.id);
  const comments = interactions.commentsByPost.get(post.id) || [];
  const topLevelComments = comments.filter(comment => !comment.parent_comment_id);
  const isOwner = currentUser?.id === post.user_id;

  return `
    <article class="post-card liquid-glass-bar" data-post-id="${escapeHTML(post.id)}">
      <header class="post-header">
        <div class="user-info">
          ${profileLink ? `<a class="profile-avatar-link" href="${profileLink}" aria-label="前往 ${name} 的個人檔案">` : ''}<div class="avatar post-author-avatar">${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="" />` : shortAvatar}</div>${profileLink ? '</a>' : ''}
          <div>
            <h4 class="username">${profileLink ? `<a href="${profileLink}">${name}</a>` : name} <small class="text-muted" style="font-weight: normal; font-size: 0.8rem;">${username}</small></h4>
            <span class="post-time">${escapeHTML(formatTimeAgo(post.created_at))}</span>
          </div>
        </div>
        ${isOwner ? '<button type="button" class="post-delete-button" data-action="delete-post" aria-label="刪除貼文">刪除貼文</button>' : ''}
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
        ${topLevelComments.map(comment => renderComment(comment, interactions)).join('')}
        <form class="comment-form" data-parent-comment-id="">
          <input type="text" name="content" maxlength="1000" placeholder="寫下留言..." aria-label="留言內容" required />
          <button type="submit" class="btn-comment">送出</button>
        </form>
      </div>
    </article>
  `;
}

function initPostInteractionListeners() {
  document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    const actionButton = target?.closest('[data-action]');
    if (!actionButton) return;

    if (actionButton.dataset.action === 'reply') {
      const form = document.getElementById(actionButton.getAttribute('aria-controls'));
      form?.classList.toggle('hidden');
      form?.querySelector('input')?.focus();
      return;
    }

    if (actionButton.dataset.action === 'delete-post' || actionButton.dataset.action === 'delete-comment') {
      if (!currentUser) {
        showLoginModal();
        return;
      }
      const isPost = actionButton.dataset.action === 'delete-post';
      const row = isPost ? actionButton.closest('[data-post-id]') : actionButton.closest('[data-comment-id]');
      const id = isPost ? row?.dataset.postId : row?.dataset.commentId;
      if (!id || !await showConfirmation(isPost ? '確定刪除這則貼文和其中所有留言嗎？' : '確定刪除這則留言嗎？')) return;

      const result = isPost
        ? await supabase.from('posts').delete().eq('id', id)
        : await supabase.from('post_comments').delete().eq('id', id);
      if (result.error) {
        await showNotice(`刪除${isPost ? '貼文' : '留言'}失敗：` + result.error.message, 'error');
        return;
      }
      refreshPostLists();
      return;
    }

    if (actionButton.dataset.action !== 'like') return;
    if (!currentUser) {
      showLoginModal();
      return;
    }

    const postId = actionButton.closest('[data-post-id]').dataset.postId;
    const { data: existingLike, error: lookupError } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('post_id', postId)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (lookupError) {
      await showNotice('讀取按讚狀態失敗：' + lookupError.message, 'error');
      return;
    }

    const result = existingLike
      ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
      : await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
    if (result.error) {
      await showNotice('更新按讚失敗：' + result.error.message, 'error');
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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      showLoginModal();
      return;
    }

    const content = String(new FormData(form).get('content') || '').trim();
    if (!content) return;
    const postId = form.closest('[data-post-id]').dataset.postId;
    const comment = {
      post_id: postId,
      user_id: session.user.id,
      content
    };
    if (form.dataset.parentCommentId) comment.parent_comment_id = form.dataset.parentCommentId;
    const { error } = await supabase.from('post_comments').insert(comment);
    if (error) {
      await showNotice('留言失敗：' + error.message, 'error');
      return;
    }
    refreshPostLists();
  });
}

function refreshPostLists() {
  if (document.getElementById('posts-container')) loadFeed();
  if (currentProfile && document.getElementById('user-posts-container')) loadUserPosts(currentProfile.id);
}