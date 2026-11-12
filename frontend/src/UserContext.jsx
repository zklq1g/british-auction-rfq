import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

export function UserProvider({ children }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(localStorage.getItem('userId'));
  const [error, setError] = useState('');

  useEffect(() => {
    api('/users')
      .then((list) => {
        setUsers(list);
        const valid = list.some((u) => String(u.id) === String(userId));
        if (!valid && list[0]) select(list[0].id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(id) {
    localStorage.setItem('userId', String(id));
    setUserId(String(id));
  }

  const user = users.find((u) => String(u.id) === String(userId)) || null;

  // Don't render pages until we know who the user is (API calls need the header)
  if (error) return <p className="error page">Could not reach the API: {error}</p>;
  if (!user) return <p className="page">Loading…</p>;

  return (
    <UserContext.Provider value={{ user, users, selectUser: select }}>
      {children}
    </UserContext.Provider>
  );
}
