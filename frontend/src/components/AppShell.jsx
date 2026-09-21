import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut, UserCircle, Menu, X } from 'lucide-react';

/**
 * Shared responsive shell: fixed sidebar on lg+, drawer + top bar on mobile/tablet.
 */
const AppShell = ({ title, subtitle, menuItems, children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const go = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  const SidebarContent = ({ onNavigate }) => (
    <>
      <div className="p-5 sm:p-6 border-b border-gray-800">
        <h1 className="text-lg sm:text-xl font-bold leading-tight">{title}</h1>
        <p className="text-gray-400 text-sm mt-1">{subtitle}</p>
      </div>

      <nav className="flex-1 p-3 sm:p-4 space-y-1.5 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-start gap-3 px-3 sm:px-4 py-3 rounded-lg transition-all text-left ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{item.label}</span>
                {item.description && (
                  <span
                    className={`block text-xs mt-0.5 leading-snug ${
                      isActive ? 'text-primary-100' : 'text-gray-500'
                    }`}
                  >
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 sm:p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 sm:px-4 py-3 rounded-lg bg-gray-800 mb-3">
          <UserCircle className="w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {user?.role === 'admin' ? 'Admin' : user?.email || user?.role}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm">Logout</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-gray-900 text-white flex-col z-40">
        <SidebarContent onNavigate={go} />
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-gray-900 text-white border-b border-gray-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-gray-800"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{title}</p>
            <p className="text-xs text-gray-400 truncate">{subtitle}</p>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[min(18rem,85vw)] bg-gray-900 text-white flex flex-col shadow-xl animate-slide-in">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <span className="font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent onNavigate={go} />
          </aside>
        </div>
      )}

      <main className="lg:ml-64 min-h-screen">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">{children}</div>
      </main>
    </div>
  );
};

export default AppShell;
