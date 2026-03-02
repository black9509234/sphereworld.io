const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// public 폴더에서 HTML 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 접속 중인 사용자 목록
const users = {};

io.on('connection', (socket) => {
  console.log('새 사용자 접속:', socket.id);

  // 닉네임 설정
  socket.on('set nickname', (nickname) => {
    users[socket.id] = nickname;
    io.emit('user list', Object.values(users));
    io.emit('system message', `${nickname}님이 입장했습니다! 👋`);
  });

  // 메시지 받기
  socket.on('chat message', (data) => {
    const nickname = users[socket.id] || '익명';
    io.emit('chat message', {
      nickname,
      message: data.message,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      id: socket.id
    });
  });

  // 타이핑 중 표시
  socket.on('typing', (isTyping) => {
    const nickname = users[socket.id];
    if (nickname) {
      socket.broadcast.emit('typing', { nickname, isTyping });
    }
  });

  // 연결 끊김
  socket.on('disconnect', () => {
    const nickname = users[socket.id];
    if (nickname) {
      io.emit('system message', `${nickname}님이 퇴장했습니다.`);
      delete users[socket.id];
      io.emit('user list', Object.values(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});