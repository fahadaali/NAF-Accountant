import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const EMPTY_USER = { email: '', password: '', role: 'user' };
const EMPTY_CHAT = { chat_id: '', label: '', is_admin: 0 };

export default function Team() {
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [chatForm, setChatForm] = useState(EMPTY_CHAT);
  const [msg, setMsg] = useState('');
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
      <div>
        <h2 className="text-2xl font-black text-slate-800">الفريق والصلاحيات</h2>
        <p className="text-slate-500 mt-1">مستخدمو اللوحة، ومحادثات تليجرام المصرّح لها</p>
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-red-700">{error}</div>}
      {msg && <div className="card border-green-200 bg-green-50 text-green-700">{msg}</div>}

      {/* ============ مستخدمو اللوحة ============ */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-1">مستخدمو لوحة التحكم</h3>
        <p className="text-slate-500 text-sm mb-4">
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
          <input
            type="email" dir="ltr" required placeholder="البريد الإلكتروني"
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={userForm.email}
            onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
          />
          <input
            type="password" dir="ltr" required placeholder="كلمة المرور (8+)"
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={userForm.password}
            onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
          />
          <select
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={userForm.role}
            onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
          >
            <option value="user">مستخدم (اطّلاع)</option>
            <option value="admin">مسؤول</option>
          </select>
          <button className="btn-primary justify-center" type="submit">إضافة</button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="text-slate-400 text-sm border-b border-slate-100">
                <th className="py-2 font-semibold">البريد</th>
                <th className="py-2 font-semibold">الصلاحية</th>
                <th className="py-2 font-semibold">الحالة</th>
                <th className="py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 text-slate-700" dir="ltr">{u.email}</td>
                  <td className="py-3">
                    <select
                      className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
                      value={u.role}
                      onChange={(e) =>
                        run(() => api.updateUser({ id: u.id, role: e.target.value }), 'تم تحديث الصلاحية.')
                      }
                    >
                      <option value="user">مستخدم</option>
                      <option value="admin">مسؤول</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <span className={`badge ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                      {u.is_active ? 'نشط' : 'معطّل'}
                    </span>
                  </td>
                  <td className="py-3">
                    <button
                      className="text-sm text-naf-600 hover:underline"
                      onClick={() =>
                        run(
                          () => api.updateUser({ id: u.id, is_active: !u.is_active }),
                          u.is_active ? 'تم تعطيل المستخدم.' : 'تم تفعيل المستخدم.'
                        )
                      }
                    >
                      {u.is_active ? 'تعطيل' : 'تفعيل'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============ محادثات تليجرام ============ */}
      <div className="card">
        <h3 className="font-bold text-slate-800 mb-1">محادثات تليجرام المصرّح لها</h3>
        <p className="text-slate-500 text-sm mb-4">
          من يستطيع إرسال العمليات للبوت. «مسؤول» يستقبل تنبيهات فشل المهام المجدولة.
          <br />
          لمعرفة معرّف المحادثة: اطلب من الموظف مراسلة البوت، ثم افتح رابط
          <code className="bg-slate-100 px-1 rounded mx-1" dir="ltr">getUpdates</code>
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
          <input
            required placeholder="معرّف المحادثة (رقم)" dir="ltr"
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={chatForm.chat_id}
            onChange={(e) => setChatForm({ ...chatForm, chat_id: e.target.value })}
          />
          <input
            placeholder="الاسم (اختياري)"
            className="border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-naf-500 outline-none"
            value={chatForm.label}
            onChange={(e) => setChatForm({ ...chatForm, label: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={!!chatForm.is_admin}
              onChange={(e) => setChatForm({ ...chatForm, is_admin: e.target.checked ? 1 : 0 })}
            />
            يستقبل التنبيهات
          </label>
          <button className="btn-primary justify-center" type="submit">إضافة</button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="text-slate-400 text-sm border-b border-slate-100">
                <th className="py-2 font-semibold">المعرّف</th>
                <th className="py-2 font-semibold">الاسم</th>
                <th className="py-2 font-semibold">تنبيهات</th>
                <th className="py-2 font-semibold">الحالة</th>
                <th className="py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {chats.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-6 text-center text-slate-400">
                    لا توجد محادثات — يُستخدم حالياً المتغيّر AUTHORIZED_CHAT_IDS الاحتياطي.
                  </td>
                </tr>
              ) : (
                chats.map((ch) => (
                  <tr key={ch.chat_id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 font-mono text-slate-600" dir="ltr">{ch.chat_id}</td>
                    <td className="py-3 text-slate-700">{ch.label || '—'}</td>
                    <td className="py-3">{ch.is_admin ? '🔔 نعم' : '—'}</td>
                    <td className="py-3">
                      <span className={`badge ${ch.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                        {ch.is_active ? 'مصرّح' : 'موقوف'}
                      </span>
                    </td>
                    <td className="py-3 flex gap-3">
                      <button
                        className="text-sm text-naf-600 hover:underline"
                        onClick={() =>
                          run(
                            () => api.saveChat({ ...ch, is_active: ch.is_active ? 0 : 1 }),
                            'تم التحديث.'
                          )
                        }
                      >
                        {ch.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                      <button
                        className="text-sm text-red-600 hover:underline"
                        onClick={() => {
                          if (confirm(`حذف المحادثة ${ch.chat_id}؟`))
                            run(() => api.deleteChat(ch.chat_id), 'تم الحذف.');
                        }}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
