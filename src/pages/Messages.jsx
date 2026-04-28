import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search, Send, Phone, Video, Trash2, Paperclip,
  Smile, MapPin, ArrowLeft, Star, Clock, MessageCircle, Headphones, AlertCircle
} from "lucide-react";

const conversations = [
  {
    id: "1",
    name: "محمد درويش",
    avatar: "م",
    lastMessage: "إن شاء الله، التقيكم هناك 🙏",
    time: "10:30",
    unread: 2,
    online: true,
    trip: "رام الله → نابلس",
  },
  {
    id: "2",
    name: "يوسف حمدان",
    avatar: "ي",
    lastMessage: "تم تأكيد حجز المقعد",
    time: "09:15",
    unread: 0,
    online: false,
    trip: "نابلس → رام الله",
  },
  {
    id: "3",
    name: "سامي أبو أحمد",
    avatar: "س",
    lastMessage: "أكيد سأكون متواجداً",
    time: "أمس",
    unread: 0,
    online: true,
    trip: "الخليل → بيت لحم",
  },
  {
    id: "4",
    name: "دعم سيرتنا",
    avatar: "🚗",
    lastMessage: "مرحباً أحمد، كيف يمكننا مساعدتك؟",
    time: "30 أبريل",
    unread: 0,
    online: true,
    trip: null,
  },
];

const chatMessages = [
  { id: "1", sender: "other", text: "السلام عليكم أحمد.\nتم تأكيد حجزك في رحلتي إلى نابلس يوم السبت الساعة 08:30 صباحاً.", time: "10:15" },
  { id: "2", sender: "me", text: "وعليكم السلام محمد.\nشكراً لك، هل يمكنك معرفة موقع الانطلاق؟", time: "10:17" },
  { id: "3", sender: "other", text: "بالتأكيد، نقطة الانطلاق ستكون دوار المنارة - رام الله.\nسأكون بانتظارك أمام محطة الباصات.", time: "10:18" },
  { id: "4", sender: "me", text: "ممتاز 👍\nهل يوجد رقم للتواصل في حال أي طارئ؟", time: "10:19" },
  { id: "5", sender: "other", text: "نعم، هذا رقمي 0591234567\nلا تتردد بالتواصل معي في أي وقت.", time: "10:20" },
  { id: "6", sender: "me", text: "إن شاء الله، التقيكم هناك 🙏", time: "10:30" },
];

export default function Messages() {
  const [selectedChat, setSelectedChat] = useState(conversations[0]);
  const [message, setMessage] = useState("");
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [localMessages, setLocalMessages] = useState(chatMessages);
  const [localConversations, setLocalConversations] = useState(conversations);
  const [undoable, setUndoable] = useState(null);
  const [phoneError, setPhoneError] = useState(null);

  const hasPhoneNumber = (text) => {
    // Remove all non-digit characters to catch tricks like 599&7272))569 or 5997272__658
    const digitsOnly = text.replace(/\D/g, '');
    
    // Check for 9-10 digit sequences (Palestinian/Saudi numbers)
    // 0591234567 (10 digits starting with 0) or 966591234567 (12 digits with country code)
    if (/^(966)?[0]?[5-9]\d{7,8}$/.test(digitsOnly)) {
      return true;
    }
    
    return false;
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    
    // Check for phone numbers (catches variations with separators, underscores, parentheses, etc.)
    if (hasPhoneNumber(trimmed)) {
      setPhoneError("لا يمكن مشاركة أرقام الهاتف في المحادثة");
      setTimeout(() => setPhoneError(null), 3000);
      return;
    }

    const newMsg = { id: String(Date.now()), sender: "me", text: trimmed, time: new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) };
    setLocalMessages((prev) => [...prev, newMsg]);
    setMessage("");
    setPhoneError(null);
    
    // Enable undo for 30 seconds
    setUndoable(newMsg.id);
    setTimeout(() => setUndoable(null), 30000);
  };

  const handleUndo = () => {
    if (!undoable) return;
    setLocalMessages((prev) => prev.filter((m) => m.id !== undoable));
    setUndoable(null);
  };

  const handleDeleteChat = (convId) => {
    setLocalConversations((prev) => prev.filter((c) => c.id !== convId));
    if (selectedChat?.id === convId) {
      setSelectedChat(null);
      setShowMobileChat(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
      <div className="bg-card rounded-none sm:rounded-2xl border-0 sm:border border-border overflow-hidden h-[calc(100vh-5rem)]">
        <div className="flex h-full">
          {/* Conversations List */}
          <div className={`w-full sm:w-80 lg:w-96 border-l border-border flex flex-col ${showMobileChat ? "hidden sm:flex" : "flex"}`}>
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold">المحادثات</h2>
                <button className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <MessageCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="ابحث في المحادثات..." className="pr-10 rounded-xl bg-muted/50 border-0 h-10" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {localConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => { setSelectedChat(conv); setShowMobileChat(true); }}
                  className={`w-full p-4 flex items-start gap-3 hover:bg-muted/50 transition-colors border-b border-border/50 group ${
                    selectedChat?.id === conv.id ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                      {conv.avatar}
                    </div>
                    {conv.online && (
                      <div className="absolute bottom-0 left-0 w-3 h-3 bg-green-500 border-2 border-card rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 text-right min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className="font-medium text-sm truncate">{conv.name}</h3>
                      <span className="text-xs text-muted-foreground shrink-0">{conv.time}</span>
                    </div>
                    {conv.trip && (
                      <p className="text-xs text-primary mb-0.5">رحلة: {conv.trip}</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                  </div>
                  {conv.unread > 0 && (
                    <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">
                      {conv.unread}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChat(conv.id);
                    }}
                    className="p-1 rounded-lg hover:bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="حذف المحادثة"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </button>
              ))}
            </div>

            {/* Support */}
            <div className="p-4 border-t border-border bg-muted/30">
              <div className="text-center">
                <Headphones className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                <p className="text-xs text-muted-foreground mb-2">تحتاج مساعدة؟</p>
                <Button size="sm" className="rounded-xl bg-primary text-primary-foreground text-xs">
                  تواصل مع الدعم
                </Button>
              </div>
            </div>
          </div>

          {/* Chat Area */}
          <div className={`flex-1 flex flex-col ${!showMobileChat ? "hidden sm:flex" : "flex"}`}>
            {selectedChat ? (
              <>
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between bg-card">
                  <div className="flex items-center gap-3">
                    <button className="sm:hidden" onClick={() => setShowMobileChat(false)}>
                      <ArrowLeft className="w-5 h-5 rotate-180" />
                    </button>
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                        {selectedChat.avatar}
                      </div>
                      {selectedChat.online && (
                        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 bg-green-500 border-2 border-card rounded-full" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{selectedChat.name}</h3>
                      <p className="text-xs text-green-600">{selectedChat.online ? "متصل الآن" : "آخر ظهور منذ ساعة"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => alert(`اتصال مع ${selectedChat.name}`)} className="p-2 rounded-lg hover:bg-muted" title="مكالمة صوتية"><Phone className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={() => alert(`مكالمة فيديو مع ${selectedChat.name}`)} className="p-2 rounded-lg hover:bg-muted" title="مكالمة فيديو"><Video className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={() => { if (confirm("هل تريد حذف هذه المحادثة؟")) { handleDeleteChat(selectedChat.id); } }} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive" title="حذف المحادثة"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* Trip Info */}
                {selectedChat.trip && (
                  <div className="px-4 py-2 bg-primary/5 border-b border-border flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-primary">{selectedChat.trip}</span>
                    <span className="text-xs text-muted-foreground">• السبت 25 مايو • 08:30 ص</span>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/20">
                  <div className="text-center">
                    <span className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">24 مايو</span>
                  </div>
                  {localMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === "me" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        msg.sender === "me"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border border-border rounded-bl-sm"
                      }`}>
                        <p className="text-sm whitespace-pre-line">{msg.text}</p>
                        <p className={`text-[10px] mt-1 ${msg.sender === "me" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                          {msg.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Undo notification */}
                {undoable && (
                  <div className="px-3 py-2 bg-primary/10 border-t border-primary/20 flex items-center justify-between">
                    <span className="text-xs text-primary">آخر رسالة أرسلتها</span>
                    <button
                      onClick={handleUndo}
                      className="text-xs text-primary font-medium hover:underline"
                    >
                      تراجع (30 ثانية)
                    </button>
                  </div>
                )}

                {/* Phone error */}
                {phoneError && (
                  <div className="px-3 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {phoneError}
                  </div>
                )}

                {/* Input */}
                <div className="p-3 border-t border-border bg-card">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      id="file-input"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) alert(`تم تحديد الملف: ${file.name}`);
                      }}
                    />
                    <button
                      onClick={() => document.getElementById("file-input")?.click()}
                      className="p-2 rounded-lg hover:bg-muted transition-colors"
                    >
                      <Paperclip className="w-5 h-5 text-muted-foreground" />
                    </button>
                    <Input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSend()}
                      placeholder="اكتب رسالة..."
                      className="flex-1 rounded-xl bg-muted/50 border-0 h-10"
                    />
                    <Button size="icon" className="rounded-xl bg-primary text-primary-foreground h-10 w-10 shrink-0" onClick={handleSend}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">اختر محادثة للبدء</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}