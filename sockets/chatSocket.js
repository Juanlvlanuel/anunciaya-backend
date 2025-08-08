const Chat = require("../models/Chat");
const Mensaje = require("../models/Mensaje");

exports.registerChatSocket = (io, socket) => {
  socket.on("join", ({ usuarioId }) => {
    socket.data.usuarioId = usuarioId;
    socket.join(`user:${usuarioId}`);
  });

  socket.on("chat:send", async (payload, cb) => {
    try {
      const { chatId, emisorId, texto, archivos = [] } = payload;
      if (!chatId || !emisorId || (!texto && archivos.length === 0))
        return cb?.({ ok: false, error: "Payload inválido" });

      const msg = await Mensaje.create({ chat: chatId, emisor: emisorId, texto, archivos });
      await Chat.findByIdAndUpdate(chatId, {
        ultimoMensaje: texto || (archivos.length ? "📎 Archivo" : ""),
        ultimoMensajeAt: new Date(),
      });

      const populated = await msg.populate("emisor", "nombre avatarUrl");
      const chat = await Chat.findById(chatId).populate("participantes", "_id");
      chat.participantes.forEach((u) => {
        io.to(`user:${u._id.toString()}`).emit("chat:newMessage", { chatId, mensaje: populated });
      });

      cb?.({ ok: true, mensaje: populated });
    } catch (e) {
      cb?.({ ok: false, error: e.message });
    }
  });

  socket.on("chat:typing", ({ chatId, usuarioId, typing }) => {
    if (!chatId || !usuarioId) return;
    io.emit("chat:typing", { chatId, usuarioId, typing: !!typing });
  });
};
