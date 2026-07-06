// ---------- DOM-элементы ----------
const loginArea = document.getElementById('login-area');
const chatArea = document.getElementById('chat-area');
const usernameInput = document.getElementById('username-input');
const loginError = document.getElementById('login-error');
const currentUserSpan = document.getElementById('current-user');
const messages = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const fileStatus = document.getElementById('file-status');
const loading = document.getElementById('loading');
const welcome = document.getElementById('welcomeMsg');

let currentUser = '';
let isGenerating = false;
let currentReader = null;

// ---------- Кнопка скачивания JSON ----------
function createDownloadButton(jsonData) {
    const container = document.createElement('div');
    container.style.marginTop = '8px';
    container.style.display = 'block';
    container.style.clear = 'both';

    const btn = document.createElement('button');
    btn.textContent = 'Скачать JSON';
    btn.className = 'download-json-btn';

    btn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ответ_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    container.appendChild(btn);
    return container;
}

// ---------- Drag and Drop ----------
function setupDragAndDrop() {
    const dropZone = document.getElementById('chat-area');
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            uploadFile(e.dataTransfer.files[0]);
        }
    });
}

// ---------- Вход ----------
function login() {
    const name = usernameInput.value.trim();
    if (!name) {
        loginError.style.display = 'block';
        return;
    }
    loginError.style.display = 'none';
    currentUser = name;
    currentUserSpan.textContent = currentUser;

    loginArea.style.display = 'none';
    chatArea.style.display = 'flex';

    setupDragAndDrop();
    loadHistory();
    addMessage('bot', 'Привет, ' + currentUser + '! Задай вопрос или загрузи файл для анализа.');
}

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

// ---------- Загрузка истории ----------
async function loadHistory() {
    if (!currentUser) return;
    try {
        const response = await fetch(`/history?user=${encodeURIComponent(currentUser)}`);
        const history = await response.json();
        if (history.length === 0) return;
        if (welcome) welcome.style.display = 'none';
        history.forEach(msg => {
            addMessage(msg.role, msg.text);
        });
    } catch (e) {
        console.log('Не удалось загрузить историю:', e);
    }
}

// ---------- Остановка генерации ----------
async function stopGeneration() {
    if (!isGenerating) return;
    try {
        await fetch('/stop', { method: 'POST' });
        if (currentReader) {
            await currentReader.cancel();
            currentReader = null;
        }
        stopBtn.style.display = 'none';
        isGenerating = false;
        loading.style.display = 'none';
    } catch (e) {
        console.log('Ошибка остановки:', e);
    }
}

stopBtn.addEventListener('click', stopGeneration);

// ---------- Отправка сообщения (потоковый режим) ----------
async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !currentUser) return;

    if (isGenerating) {
        await stopGeneration();
        return;
    }

    if (welcome) welcome.style.display = 'none';
    addMessage('user', text);
    msgInput.value = '';

    const botDiv = document.createElement('div');
    botDiv.className = 'msg bot';
    const contentDiv = document.createElement('div');
    botDiv.appendChild(contentDiv);
    messages.appendChild(botDiv);
    messages.scrollTop = messages.scrollHeight;

    stopBtn.style.display = 'inline-block';
    isGenerating = true;
    loading.style.display = 'block';

    let fullText = '';
    let jsonData = null;

    try {
        const response = await fetch('/chat_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                username: currentUser
            })
        });

        const reader = response.body.getReader();
        currentReader = reader;
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[STOP]') {
                        fullText += '\n\n[Генерация остановлена]';
                        contentDiv.innerHTML = marked.parse(fullText);
                        stopBtn.style.display = 'none';
                        isGenerating = false;
                        loading.style.display = 'none';
                        currentReader = null;
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.text) {
                            fullText = parsed.text;
                            contentDiv.innerHTML = marked.parse(fullText);
                            messages.scrollTop = messages.scrollHeight;
                        }
                        if (parsed.done) {
                            jsonData = parsed.json_data || null;
                            stopBtn.style.display = 'none';
                            isGenerating = false;
                            loading.style.display = 'none';
                            currentReader = null;
                        }
                    } catch (e) {
                        // Игнорируем ошибки парсинга
                    }
                }
            }
        }

        if (jsonData) {
            const downloadBtn = createDownloadButton(jsonData);
            botDiv.appendChild(downloadBtn);
        }

    } catch (e) {
        if (e.name !== 'AbortError') {
            contentDiv.innerHTML = 'Ошибка соединения';
        }
        stopBtn.style.display = 'none';
        isGenerating = false;
        loading.style.display = 'none';
        currentReader = null;
    }
}

// ---------- Добавление сообщения (обычное, для истории) ----------
function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    if (role === 'bot') {
        div.innerHTML = marked.parse(text);
    } else {
        div.textContent = text;
    }
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// ---------- Загрузка файла ----------
async function uploadFile(file) {
    const allowed = ['.txt', '.pdf', '.docx', '.xlsx', '.xls', '.csv'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
        addMessage('bot', 'Неподдерживаемый формат. Разрешены: ' + allowed.join(', '));
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();

        if (data.error) {
            addMessage('bot', data.error);
            return;
        }

        fileBtn.classList.add('loaded');
        fileStatus.textContent = file.name;
        addMessage('bot', 'Файл "' + file.name + '" загружен. Можно задавать по нему вопросы.');
    } catch (e) {
        addMessage('bot', 'Ошибка загрузки файла.');
    }
}

// ---------- События ----------
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
    }
    fileInput.value = '';
});