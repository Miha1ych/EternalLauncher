import { useRef, useState } from 'react';
import {
  HomeIcon, SearchIcon, LibraryIcon, SettingsIcon, UserIcon, ShirtIcon, CameraIcon, LayersIcon, BarChartIcon,
} from './Icons.jsx';
import AccountFace from './AccountFace.jsx';
import PremiumButton from './PremiumButton.jsx';
import AccountSwitcher from './AccountSwitcher.jsx';
import { useOrder } from '../utils/useOrder.js';

export default function Sidebar({
  page, onNavigate, account, onAccountChange, showBuilderTools, showStats, showSearch = true,
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const avatarRef = useRef(null);

  // Icons can be dragged to change their order (saved in settings).
  const items = {
    home: { title: 'Главная', Icon: HomeIcon, visible: true },
    search: { title: 'Поиск', Icon: SearchIcon, visible: showSearch },
    library: { title: 'Библиотека', Icon: LibraryIcon, visible: true },
    skins: { title: 'Скины', Icon: ShirtIcon, visible: true },
    screenshots: { title: 'Скриншоты', Icon: CameraIcon, visible: true },
    stats: { title: 'Статистика', Icon: BarChartIcon, visible: showStats },
    schematics: { title: 'Схематики', Icon: LayersIcon, visible: showBuilderTools },
  };
  const { order, itemProps } = useOrder('sidebarOrder', Object.keys(items));

  return (
    <div className="sidebar">
      <div className="sidebar-avatar-wrap">
        <button ref={avatarRef} className="sidebar-avatar" onClick={() => setSwitcherOpen((v) => !v)} title={account ? account.name : 'Аккаунты'}>
          <AccountFace account={account} size={52} />
        </button>
        {switcherOpen && (
          <AccountSwitcher
            anchorRef={avatarRef}
            onClose={() => setSwitcherOpen(false)}
            onActiveAccountChange={(a) => { onAccountChange(a); }}
          />
        )}
      </div>

      {order.map((id) => {
        const item = items[id];
        if (!item.visible) return null;
        const Icon = item.Icon;
        return (
          <button
            key={id}
            className={`sidebar-icon ${page === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
            title={item.title}
            {...itemProps(id)}
          >
            <Icon />
          </button>
        );
      })}

      <div className="sidebar-spacer" />

      <PremiumButton variant="side" />
      <button className={`sidebar-icon ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} title="Настройки">
        <SettingsIcon />
      </button>
    </div>
  );
}
