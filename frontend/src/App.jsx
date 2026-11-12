import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useUser } from './UserContext';
import AuctionList from './pages/AuctionList';
import AuctionDetails from './pages/AuctionDetails';
import CreateRfq from './pages/CreateRfq';

export default function App() {
  const { user, users, selectUser } = useUser();

  return (
    <>
      <header className="topbar">
        <strong>British Auction RFQ</strong>
        <nav>
          <NavLink to="/auctions">Auctions</NavLink>
          {user.role === 'BUYER' && <NavLink to="/create">Create RFQ</NavLink>}
        </nav>
        <label className="user-switch">
          Acting as{' '}
          <select value={user.id} onChange={(e) => selectUser(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/auctions" replace />} />
          <Route path="/auctions" element={<AuctionList />} />
          <Route path="/auctions/:id" element={<AuctionDetails />} />
          <Route path="/create" element={<CreateRfq />} />
        </Routes>
      </main>
    </>
  );
}
