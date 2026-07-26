import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Bell, CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { Alert, AlertDescription } from '../naf/ui/alert.jsx';
import { Button } from '../naf/ui/button.jsx';
import { Input } from '../naf/ui/input.jsx';
import { Card } from '../naf/ui/card.jsx';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../naf/ui/table.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Badge } from '../naf/ui/badge.jsx';

const EMPTY_USER = { email: '', password: '', role: 'user' };
const EMPTY_CHAT = { chat_id: '', label: '', is_admin: 0 };

export default function Team() {
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [chatForm, setChatForm] = useState(EMPTY_CHAT);
  const [msg, setMsg] = useState('');
  const [pendingChat, setPendingChat] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [u, c] = await Promise.all([api.users(), api.chats()]);
      setUsers(u.users);
      setChats(c.chats);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const run = async (fn, successMsg) => {
    setMsg('');
    setError('');
    try {
      await fn();
      setMsg(successMsg);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      {pendingChat && (
        <ConfirmDialog
          open={!!pendingChat}
          onOpenChange={(v) => !v && setPendingChat(null)}
          title="حذف المحادثة"
          description={`لن يستقبل النظام عمليات من المحادثة ${pendingChat.chat_id} بعد الحذف.`}
          actionLabel="حذف"
          onConfirm={() => run(() => api.deleteChat(pendingChat.chat_id), 'تم الحذف.')}
        />
      )}
      <div>
        <h2 className="text-2xl font-bold text-foreground">الفريق والصلاحيات</h2>
        <p className="text-muted-foreground mt-1">مستخدمو اللوحة، ومحادثات تليجرام المصرّح لها</p>
      </div>

      {error && <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert>}
      {msg && <Alert variant="success"><CircleCheck /><AlertDescription>{msg}</AlertDescription></Alert>}

      {/* ============ مستخدمو اللوحة ============ */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">مستخدمو لوحة التحكم</h3>
        <p className="text-muted-foreground text-sm mb-4">
          «مسؤول» يملك كل الصلاحيات · «مستخدم» يطّلع فقط دون تعديل أو حذف.
        </p>

        <form
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addUser(userForm);
              setUserForm(EMPTY_USER);
            }, 'تمت إضافة المستخدم.');
          }}
        >
          <Input
            type="email" dir="ltr" required placeholder="البريد الإلكتروني"
            value={userForm.email}
            onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
          />
          <Input
            type="password" dir="ltr" required placeholder="كلمة المرور (8+)"
            value={userForm.password}
            onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
          />
          <select
            className="border border-border rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring outline-none"
            value={userForm.role}
            onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
          >
            <option value="user">مستخدم (اطّلاع)</option>
            <option value="admin">مسؤول</option>
          </select>
          <Button className="justify-center" type="submit">إضافة</Button>
        </form>

                  <Table>
            <TableHeader>
              <TableRow>
                <TableHead>البريد</TableHead>
                <TableHead>الصلاحية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="text-foreground" dir="ltr">{u.email}</TableCell>
                  <TableCell>
                    <select
                      className="border border-border rounded-lg px-2 py-1 text-sm"
                      value={u.role}
                      onChange={(e) =>
                        run(() => api.updateUser({ id: u.id, role: e.target.value }), 'تم تحديث الصلاحية.')
                      }
                    >
                      <option value="user">مستخدم</option>
                      <option value="admin">مسؤول</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? 'success' : 'default'}>
                      {u.is_active
                        ? <><CircleCheck size={16} aria-hidden="true" /> نشط</>
                        : <><CircleSlash size={16} aria-hidden="true" /> معطّل</>}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="link" size="sm"
                      className="px-0"
                      onClick={() =>
                        run(
                          () => api.updateUser({ id: u.id, is_active: !u.is_active }),
                          u.is_active ? 'تم تعطيل المستخدم.' : 'تم تفعيل المستخدم.'
                        )
                      }
                    >
                      {u.is_active ? 'تعطيل' : 'تفعيل'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </Card>

      {/* ============ محادثات تليجرام ============ */}
      <Card className="p-6">
        <h3 className="font-bold text-foreground mb-1">محادثات تليجرام المصرّح لها</h3>
        <p className="text-muted-foreground text-sm mb-4">
          من يستطيع إرسال العمليات للبوت. «مسؤول» يستقبل تنبيهات فشل المهام المجدولة.
          <br />
          لمعرفة معرّف المحادثة: اطلب من الموظف مراسلة البوت، ثم افتح رابط
          <code className="bg-muted px-1 rounded-sm mx-1" dir="ltr">getUpdates</code>
          الخاص بالبوت.
        </p>

        <form
          className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.saveChat(chatForm);
              setChatForm(EMPTY_CHAT);
            }, 'تم حفظ المحادثة.');
          }}
        >
          <Input
            required placeholder="معرّف المحادثة (رقم)" dir="ltr"
            value={chatForm.chat_id}
            onChange={(e) => setChatForm({ ...chatForm, chat_id: e.target.value })}
          />
          <Input
            placeholder="الاسم (اختياري)"
            value={chatForm.label}
            onChange={(e) => setChatForm({ ...chatForm, label: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={!!chatForm.is_admin}
              onChange={(e) => setChatForm({ ...chatForm, is_admin: e.target.checked ? 1 : 0 })}
            />
            يستقبل التنبيهات
          </label>
          <Button className="justify-center" type="submit">إضافة</Button>
        </form>

                  <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المعرّف</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>تنبيهات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    لم تُضِف أي محادثة بعد. يُستخدم حالياً المتغيّر AUTHORIZED_CHAT_IDS الاحتياطي.
                  </TableCell>
                </TableRow>
              ) : (
                chats.map((ch) => (
                  <TableRow key={ch.chat_id}>
                    <TableCell className="font-mono text-foreground" dir="ltr">{ch.chat_id}</TableCell>
                    <TableCell className="text-foreground">{ch.label || '—'}</TableCell>
                    <TableCell>{ch.is_admin ? <span className="inline-flex items-center gap-2"><Bell size={16} /> نعم</span> : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={ch.is_active ? 'success' : 'default'}>
                        {ch.is_active
                          ? <><CircleCheck size={16} aria-hidden="true" /> نشط</>
                          : <><CircleSlash size={16} aria-hidden="true" /> معطّل</>}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-3">
                      <Button variant="link" size="sm"
                        className="px-0"
                        onClick={() =>
                          run(
                            () => api.saveChat({ ...ch, is_active: ch.is_active ? 0 : 1 }),
                            'تم التحديث.'
                          )
                        }
                      >
                        {ch.is_active ? 'إيقاف' : 'تفعيل'}
                      </Button>
                      <Button variant="link" size="sm"
                        className="px-0 text-destructive"
                        onClick={() => setPendingChat(ch)}
                      >
                        حذف
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}
