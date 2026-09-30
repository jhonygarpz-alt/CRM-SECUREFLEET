import { useEffect, useState } from 'react';

let push = () => {};
export const toast = (msg, type = 'ok') => push({ msg, type, id: Math.random() });

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4500);
    };
  }, []);
  return (
    <div className="toaster">
      {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
    </div>
  );
}
