console.log("=== 正在运行最新版的 start.js ===");
// ================= 星空背景生成逻辑 =================
function createStars() {
    const starContainer = document.getElementById('stars-container');
    const starCount = 150; 

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.classList.add('star');
        
        star.style.left = Math.random() * 100 + 'vw';
        star.style.top = Math.random() * 100 + 'vh';
        
        const size = Math.random() * 2 + 1;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        
        star.style.animationDuration = (Math.random() * 1.5 + 0.5) + 's'; 
        star.style.animationDelay = (Math.random() * 2) + 's';
        
        starContainer.appendChild(star);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    createStars();
});

// ================= BGM 音乐系统逻辑 =================
const dayBgmPaths = [
    '../assets/bgm/daybgm1.mp3',
    '../assets/bgm/daybgm2.mp3',
    '../assets/bgm/daybgm3.mp3',
    '../assets/bgm/daybgm4.mp3',
    '../assets/bgm/daybgm5.mp3'
];

const nightBgmPaths = [
    '../assets/bgm/nightbgm1.mp3',
    '../assets/bgm/nightbgm2.mp3',
    '../assets/bgm/nightbgm3.mp3',
    '../assets/bgm/nightbgm4.mp3',
    '../assets/bgm/nightbgm5.mp3'
];

const bgmAudio = new Audio();
bgmAudio.loop = true; 
bgmAudio.volume = 0;  

const FADE_DURATION = 800; // 淡入淡出时间 (毫秒)
const MAX_VOLUME = 0.6;    // 最大音量 (0 到 1)
let fadeInterval = null;   

// 安全的音量淡入淡出函数
function fadeAudio(targetVolume, callback) {
    if (fadeInterval) clearInterval(fadeInterval);
    
    // 如果当前音量已经等于目标音量，直接返回
    if (Math.abs(bgmAudio.volume - targetVolume) < 0.01) {
        bgmAudio.volume = targetVolume;
        if (callback) callback();
        return;
    }
    
    const stepTime = 50; 
    const steps = FADE_DURATION / stepTime;
    const volumeStep = (targetVolume - bgmAudio.volume) / steps;
    
    fadeInterval = setInterval(() => {
        let newVolume = bgmAudio.volume + volumeStep;
        
        if ((volumeStep > 0 && newVolume >= targetVolume) || 
            (volumeStep < 0 && newVolume <= targetVolume)) {
            bgmAudio.volume = Math.max(0, Math.min(1, targetVolume));
            clearInterval(fadeInterval);
            if (callback) callback(); 
        } else {
            bgmAudio.volume = Math.max(0, Math.min(1, newVolume));
        }
    }, stepTime);
}

function playRandomMusic(isDay) {
    const list = isDay ? dayBgmPaths : nightBgmPaths;
    const randomMusic = list[Math.floor(Math.random() * list.length)];
    
    console.log(`[BGM] 尝试播放: ${randomMusic}`); // 控制台日志
    
    if (!bgmAudio.paused && bgmAudio.src) {
        fadeAudio(0, () => {
            bgmAudio.src = randomMusic;
            bgmAudio.play().then(() => {
                console.log("[BGM] 音乐切换成功，正在淡入...");
                fadeAudio(MAX_VOLUME);
            }).catch(e => console.error("[BGM] 播放被拦截:", e));
        });
    } else {
        bgmAudio.src = randomMusic;
        bgmAudio.volume = 0;
        bgmAudio.play().then(() => {
            console.log("[BGM] 首次播放成功，正在淡入...");
            fadeAudio(MAX_VOLUME);
        }).catch(e => console.error("[BGM] 首次播放被拦截:", e));
    }
}

// ================= UI 交互逻辑 =================
const btnStart = document.getElementById('btn-start');
const btnLoad = document.getElementById('btn-load');
const btnSwitch = document.getElementById('btn-switch');
const roleOverlay = document.getElementById('role-overlay');
const roleMage = document.getElementById('role-mage');
const roleArcher = document.getElementById('role-archer');
const roleCancel = document.getElementById('role-cancel');
const runToken = new URLSearchParams(window.location.search).get('run');

let isDayMode = false;
let hasInteracted = false; 

// 核心：强制解除浏览器音频限制
function unlockAudio() {
    if (!hasInteracted) {
        hasInteracted = true;
        console.log("[系统] 用户已交互，音频限制解除");
        if (bgmAudio.paused) {
            playRandomMusic(isDayMode);
        }
    }
}

// 无论点击页面哪里，都先尝试解锁音频
document.addEventListener('click', unlockAudio, { once: true });

function updateSwitchButtonText() {
    if (!btnSwitch) return;
    btnSwitch.textContent = isDayMode ? '切换为夜间' : '切换为白天';
}

function askPlayerRole() {
    return new Promise((resolve) => {
        if (!roleOverlay || !roleMage || !roleArcher || !roleCancel) {
            resolve('legendaryLineArcher');
            return;
        }

        roleOverlay.hidden = false;

        const lastChoice = localStorage.getItem('selectedRole') || 'legendaryLineArcher';
        roleMage.classList.toggle('is-last-choice', lastChoice === 'plainPhysicalMage');
        roleArcher.classList.toggle('is-last-choice', lastChoice === 'legendaryLineArcher');

        const cleanup = () => {
            roleOverlay.hidden = true;
            roleMage.classList.remove('is-last-choice');
            roleArcher.classList.remove('is-last-choice');
            roleMage.removeEventListener('click', onMage);
            roleArcher.removeEventListener('click', onArcher);
            roleCancel.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeydown);
        };

        const onMage = () => {
            cleanup();
            resolve('plainPhysicalMage');
        };
        const onArcher = () => {
            cleanup();
            resolve('legendaryLineArcher');
        };
        const onCancel = () => {
            cleanup();
            resolve(null);
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            }
        };

        roleMage.addEventListener('click', onMage);
        roleArcher.addEventListener('click', onArcher);
        roleCancel.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeydown);
    });
}

// 开始游戏
btnStart.addEventListener('click', async () => {
    unlockAudio(); // 确保点击按钮时也能解锁
    const selectedRole = await askPlayerRole();
    if (!selectedRole) {
        return;
    }
    localStorage.setItem('selectedRole', selectedRole);

    let gameUrl = 'map01.html?v=20260425-6';
    if (runToken) gameUrl += `&run=${encodeURIComponent(runToken)}`;
    const sessionToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    gameUrl += `&session=${encodeURIComponent(sessionToken)}`;
    gameUrl += `&role=${encodeURIComponent(selectedRole)}`;
    window.location.href = gameUrl;
});

// 读取存档
btnLoad.addEventListener('click', () => {
    unlockAudio();
    console.log("执行: 检查本地存档");
    alert("读取存档记录中...");
});

// 界面切换
if (btnSwitch) {
    updateSwitchButtonText();
    btnSwitch.addEventListener('click', () => {
        unlockAudio();
        
        isDayMode = !isDayMode;
        document.body.classList.toggle('day-mode', isDayMode);
        updateSwitchButtonText();
        
        console.log(`[系统] 切换到 ${isDayMode ? '白天' : '夜间'} 模式`);
        playRandomMusic(isDayMode);
    });
}