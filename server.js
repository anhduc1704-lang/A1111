const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const AI_QUESTIONS = [
  {
    id: 1,
    question: "AI là viết tắt của cụm từ tiếng Anh nào?",
    options: ["Automated Intelligence", "Artificial Intelligence", "Advanced Integration", "Algorithm Insight"],
    correctOption: 1
  },
  {
    id: 2,
    question: "Mô hình ngôn ngữ lớn ChatGPT do công ty nào phát triển?",
    options: ["Google", "Meta", "OpenAI", "Microsoft"],
    correctOption: 2
  },
  {
    id: 3,
    question: "Thuật ngữ 'Deep Learning' thuộc lĩnh vực nào trong AI?",
    options: ["Machine Learning", "Quantum Computing", "Blockchain", "Cybersecurity"],
    correctOption: 0
  },
  {
    id: 4,
    question: "Phép thử nổi tiếng nào dùng để đánh giá khả năng suy nghĩ giống con người của AI?",
    options: ["Voight-Kampff Test", "Turing Test", "Chomsky Test", "BBQ Test"],
    correctOption: 1
  },
  {
    id: 5,
    question: "Kiến trúc mạng Neural nào là nền tảng cho các mô hình Transformer hiện đại (như GPT, Gemini)?",
    options: ["CNN (Convolutional)", "RNN (Recurrent)", "Attention Mechanism", "GAN (Generative)"],
    correctOption: 2
  },
  {
    id: 6,
    question: "Khái niệm 'Hallucination' (Ảo giác) trong AI tạo sinh nghĩa là gì?",
    options: ["AI bị sập hệ thống", "AI tự tin đưa ra thông tin bịa đặt hoặc sai lệch", "AI bị nhiễm phần mềm độc hại", "AI tự động tắt nguồn"],
    correctOption: 1
  },
  {
    id: 7,
    question: "Năm 1997, siêu máy tính Deep Blue của IBM đã đánh bại đại kiện tướng cờ vua thế giới nào?",
    options: ["Garry Kasparov", "Magnus Carlsen", "Bobby Fischer", "Anatoly Karpov"],
    correctOption: 0
  },
  {
    id: 8,
    question: "Kỹ thuật 'Fine-tuning' trong huấn luyện AI có tác dụng chính là gì?",
    options: ["Tăng tốc độ mạng internet", "Tinh chỉnh mô hình đã học sẵn cho nhiệm vụ cụ thể", "Xóa bớt bộ nhớ RAM", "Nén file mã nguồn"],
    correctOption: 1
  }
];

const ROUND_QUOTAS = [50, 40, 30, 20, 10, 6, 3, 1];

const gameState = {
  status: 'LOBBY',
  currentQuestionIndex: 0,
  questionStartTime: 0,
  timeRemaining: 30,
  timerInterval: null,
  players: new Map()
};

function getPlayerStats() {
  const players = Array.from(gameState.players.values());
  const total = players.length;
  const alive = players.filter(p => p.status === 'ALIVE').length;
  const spectators = players.filter(p => p.status === 'SPECTATOR').length;
  return { total, alive, spectators };
}

function broadcastGameState() {
  io.emit('game-state-update', {
    status: gameState.status,
    currentQuestionIndex: gameState.currentQuestionIndex,
    timeRemaining: gameState.timeRemaining,
    stats: getPlayerStats(),
    quota: ROUND_QUOTAS[gameState.currentQuestionIndex] || 1
  });
}

function startQuestion() {
  gameState.status = 'QUESTION_ACTIVE';
  gameState.questionStartTime = Date.now();
  gameState.timeRemaining = 30;

  gameState.players.forEach(player => {
    player.currentAnswer = null;
    player.responseTimeMs = Infinity;
    player.isCorrect = false;
  });

  const q = AI_QUESTIONS[gameState.currentQuestionIndex];

  io.emit('new-question', {
    questionIndex: gameState.currentQuestionIndex,
    totalQuestions: AI_QUESTIONS.length,
    question: q.question,
    options: q.options,
    timeLimit: 30,
    quota: ROUND_QUOTAS[gameState.currentQuestionIndex]
  });

  broadcastGameState();

  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  gameState.timerInterval = setInterval(() => {
    gameState.timeRemaining -= 1;
    io.emit('timer-tick', { timeRemaining: gameState.timeRemaining });

    if (gameState.timeRemaining <= 0) {
      clearInterval(gameState.timerInterval);
      evaluateRound();
    }
  }, 1000);
}

function evaluateRound() {
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  gameState.status = 'REVEAL_ANSWER';

  const qIndex = gameState.currentQuestionIndex;
  const currentQ = AI_QUESTIONS[qIndex];
  const quota = ROUND_QUOTAS[qIndex];

  const activePlayers = Array.from(gameState.players.values()).filter(p => p.status === 'ALIVE');
  const correctPlayers = activePlayers.filter(p => p.isCorrect);

  correctPlayers.sort((a, b) => a.responseTimeMs - b.responseTimeMs);

  const survivors = correctPlayers.slice(0, quota);
  const survivorIds = new Set(survivors.map(p => p.socketId));

  gameState.players.forEach(player => {
    if (player.status === 'ALIVE') {
      if (survivorIds.has(player.socketId)) {
        player.status = 'ALIVE';
      } else {
        player.status = 'SPECTATOR';
      }
    }

    io.to(player.socketId).emit('round-result-personal', {
      status: player.status,
      isCorrect: player.isCorrect,
      responseTimeMs: player.responseTimeMs,
      correctOption: currentQ.correctOption,
      message: player.status === 'ALIVE'
        ? `🎉 Chúc mừng! Bạn đã lọt vào vòng trong! (${player.responseTimeMs} ms)`
        : `💀 Bạn đã bị loại và chuyển sang Chế độ theo dõi.`
    });
  });

  const stats = getPlayerStats();
  const isLastRound = qIndex === AI_QUESTIONS.length - 1;
  const isGameOver = isLastRound || stats.alive <= 1;

  if (isGameOver) {
    gameState.status = 'GAME_OVER';
  }

  io.emit('round-summary', {
    questionIndex: qIndex,
    correctOption: currentQ.correctOption,
    survivorsCount: survivors.length,
    survivorsList: survivors.map(s => ({ name: s.name, time: s.responseTimeMs })),
    stats: stats,
    isGameOver: isGameOver,
    winner: isGameOver && survivors.length > 0 ? survivors[0].name : (stats.alive === 1 ? Array.from(gameState.players.values()).find(p => p.status === 'ALIVE')?.name : null)
  });

  broadcastGameState();
}

io.on('connection', (socket) => {
  socket.on('player-join', (data) => {
    const playerName = (data.name || 'Người chơi').trim().slice(0, 20);
    const initialStatus = (gameState.status === 'LOBBY') ? 'ALIVE' : 'SPECTATOR';

    gameState.players.set(socket.id, {
      socketId: socket.id,
      name: playerName,
      status: initialStatus,
      currentAnswer: null,
      responseTimeMs: Infinity,
      isCorrect: false
    });

    socket.emit('join-success', {
      playerName,
      status: initialStatus,
      currentQuestionIndex: gameState.currentQuestionIndex,
      gameStatus: gameState.status
    });

    broadcastGameState();
  });

  socket.on('submit-answer', (data) => {
    const player = gameState.players.get(socket.id);

    if (!player) return;
    if (player.status !== 'ALIVE') {
      return socket.emit('answer-error', { message: 'Bạn đang ở Chế độ theo dõi.' });
    }
    if (gameState.status !== 'QUESTION_ACTIVE') {
      return socket.emit('answer-error', { message: 'Hết giờ nhận đáp án.' });
    }
    if (player.currentAnswer !== null) {
      return socket.emit('answer-error', { message: 'Bạn đã chọn đáp án cho câu này rồi.' });
    }

    const now = Date.now();
    const responseTime = now - gameState.questionStartTime;
    const currentQ = AI_QUESTIONS[gameState.currentQuestionIndex];
    const isCorrect = data.selectedOption === currentQ.correctOption;

    player.currentAnswer = data.selectedOption;
    player.responseTimeMs = responseTime;
    player.isCorrect = isCorrect;

    socket.emit('answer-ack', {
      received: true,
      selectedOption: data.selectedOption,
      responseTimeMs: responseTime
    });

    io.emit('admin-live-answer', {
      playerName: player.name,
      selectedOption: data.selectedOption,
      isCorrect,
      responseTimeMs: responseTime
    });
  });

  socket.on('admin-start-game', () => {
    gameState.currentQuestionIndex = 0;
    gameState.players.forEach(p => p.status = 'ALIVE');
    startQuestion();
  });

  socket.on('admin-next-question', () => {
    if (gameState.currentQuestionIndex < AI_QUESTIONS.length - 1) {
      gameState.currentQuestionIndex += 1;
      startQuestion();
    }
  });

  socket.on('admin-end-question', () => {
    if (gameState.status === 'QUESTION_ACTIVE') {
      evaluateRound();
    }
  });

  socket.on('admin-reset-game', () => {
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.status = 'LOBBY';
    gameState.currentQuestionIndex = 0;
    gameState.timeRemaining = 30;
    gameState.players.forEach(p => {
      p.status = 'ALIVE';
      p.currentAnswer = null;
      p.responseTimeMs = Infinity;
      p.isCorrect = false;
    });
    io.emit('game-reset');
    broadcastGameState();
  });

  socket.on('disconnect', () => {
    gameState.players.delete(socket.id);
    broadcastGameState();
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
});