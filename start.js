// 动态生成星空的函数
function createStars() {
    const starContainer = document.getElementById('stars-container');
    const starCount = 150; // 生成的星星总数

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.classList.add('star');
        
        // 随机生成屏幕上的 XY 坐标
        star.style.left = Math.random() * 100 + 'vw';
        star.style.top = Math.random() * 100 + 'vh';
        
        // 随机生成星星的大小 (1px 到 3px 之间)
        const size = Math.random() * 2 + 1;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        
        // 随机生成动画的时长和延迟，制造自然的闪烁感
        star.style.animationDuration = (Math.random() * 1.5 + 0.5) + 's'; 
        star.style.animationDelay = (Math.random() * 2) + 's';
        
        starContainer.appendChild(star);
    }
}

// 页面加载完成后立刻生成星空
document.addEventListener('DOMContentLoaded', () => {
    createStars();
});

// ================= UI 交互逻辑 =================

// 获取按钮元素
const btnStart = document.getElementById('btn-start');
const btnLoad = document.getElementById('btn-load');
const btnSwitch = document.getElementById('btn-switch');
const runToken = new URLSearchParams(window.location.search).get('run');

let isDayMode = false;

function updateSwitchButtonText() {
    if (!btnSwitch) return;
    btnSwitch.textContent = isDayMode ? '切换为夜间' : '切换为白天';
}

// 开始游戏功能
btnStart.addEventListener('click', () => {
    let gameUrl = 'soldier-idle-test.html?v=20260425-6';
    if (runToken) {
        gameUrl += `&run=${encodeURIComponent(runToken)}`;
    }
    const sessionToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    gameUrl += `&session=${encodeURIComponent(sessionToken)}`;
    window.location.href = gameUrl;
});

// 读取存档功能
btnLoad.addEventListener('click', () => {
    console.log("执行: 检查本地存档");
    alert("读取存档记录中...");
    // 未来可结合 localStorage 使用
});

// 界面切换功能
if (btnSwitch) {
    updateSwitchButtonText();

    btnSwitch.addEventListener('click', () => {
        isDayMode = !isDayMode;
        document.body.classList.toggle('day-mode', isDayMode);
        updateSwitchButtonText();
    });
}
