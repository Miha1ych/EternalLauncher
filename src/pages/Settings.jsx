import { useEffect, useState } from 'react';
import { LogOutIcon, UserIcon } from '../components/Icons.jsx';
import SkinFace from '../components/SkinFace.jsx';
import GcPicker from '../components/GcPicker.jsx';
import AccountFace from '../components/AccountFace.jsx';
import PremiumButton, { NickText } from '../components/PremiumButton.jsx';
import FoldersSettings from '../components/FoldersSettings.jsx';
import MasterOptionsSettings from '../components/MasterOptionsSettings.jsx';
import SharedServersSettings from '../components/SharedServersSettings.jsx';
import OfflineAddForm from '../components/OfflineAddForm.jsx';
import { MEM_STEP, MEM_FLOOR, memoryCap, formatMb } from '../utils/memory.js';

// Interface settings, grouped. `get` reads the on/off state from the settings
// object (some are stored inverted or default to on), `set` maps the switch
// back to the stored value.
// The monitoring overlay is switched off for now (the main process does not start it, see OVERLAY_ENABLED in ipc.js): its settings stay in the code, hidden.
const SHOW_OVERLAY_SETTINGS = false;

const flag = (key, defaultOn) => ({
  key,
  get: (s) => (defaultOn ? s[key] !== false : !!s[key]),
  set: (checked) => checked,
});

import AppearanceSettings from '../components/AppearanceSettings.jsx';
import { AUTHORS, SUPPORTERS } from '../utils/authors.js';
import { ORDER_RESET_EVENT } from '../utils/useOrder.js';
import { captureBinding, formatBinding, DEFAULT_KEYBINDINGS } from '../utils/keybind.js';

const STYLE_OPTIONS = [
  { id: 'classic', name: 'Классический', desc: 'Тёмный винный стиль, как раньше.' },
  { id: 'liquid', name: 'Жидкое стекло', desc: 'Прозрачное стекло с бликами, как в iOS.' },
];
const INTERFACE_GROUPS = [
  {
    title: 'Разделы',
    items: [
      { ...flag('showRecent', true), label: 'Недавние на главной', desc: 'Недавние миры и серверы над библиотекой.' },
      { ...flag('showBuilderTools', false), label: 'Инструменты строителя', desc: 'Раздел «Схематики» в боковой панели.' },
      { ...flag('showSearchPage', true), label: 'Страница «Поиск»', desc: 'Поиск сборок и модов на Modrinth и CurseForge в боковой панели. Поиск модов внутри сборки остаётся.' },
      { ...flag('showStatsTab', true), label: 'Вкладка «Статистика»', desc: 'Время в игре и график по дням. Время пишется и при скрытой вкладке.' },
    ],
  },
  {
    title: 'Карточки сборок',
    items: [
      { ...flag('showPlayButton', true), label: 'Кнопка «Играть»', desc: 'Появляется при наведении на карточку.' },
      { ...flag('showInstanceStats', true), label: 'Время игры', desc: 'Сколько играли и когда был последний запуск.' },
      { ...flag('showInstanceWeight', false), label: 'Вес сборки', desc: 'Размер папки сборки на диске.' },
    ],
  },
  {
    title: 'Оформление',
    items: [
      {
        key: 'reduceMotion',
        get: (s) => !s.reduceMotion,
        set: (checked) => !checked,
        label: 'Анимации',
        desc: 'Плавные появления окон, меню и кнопок. Выключите на слабом ПК.',
      },
      {
        ...flag('wormProgress', false),
        label: 'Этёрныч вместо полосок загрузки',
        desc: 'Червячок Этёрныч ползёт по всем полоскам загрузки вместо обычной линии. Работает только при включённых анимациях.',
      },
    ],
  },
];
export default function Settings({
  account, onAccountChange, onSettingsChange, updater,
}) {
  const [settings, setSettings] = useState(null);
  const [javaStatus, setJavaStatus] = useState(null);
  const [loginStatus, setLoginStatus] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [showOffline, setShowOffline] = useState(false);
  const [cfKeyDraft, setCfKeyDraft] = useState('');
  const [cfCheck, setCfCheck] = useState(null); // { busy } | { ok, message }
  // A pasted key often brings invisible characters (newline, zero-width space, quotes): they make CurseForge answer 403 as for a wrong key.
  const cleanKey = (s) => String(s || '').replace(/[\s\u00A0\u200B-\u200D\uFEFF"'`]/g, '');
  async function checkCfKey() {
    const key = cleanKey(cfKeyDraft);
    setCfKeyDraft(key);
    updateSetting('curseforgeApiKey', key);
    setCfCheck({ busy: true });
    const res = await window.api.curseforge.checkKey(key);
    setCfCheck({ ok: !!res.ok && res.kind === 'ok', message: res.message || 'Не удалось проверить ключ' });
  }
  const [appVersion, setAppVersion] = useState('');
  const [license, setLicense] = useState(null);

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s);
      setCfKeyDraft(s.curseforgeApiKey || '');
      onSettingsChange?.(s);
    });
    window.api.app.getVersion().then(setAppVersion);
    window.api.license.status().then(setLicense).catch(() => {});
    return window.api.auth.onStatus(setLoginStatus);
  }, []);

  useEffect(() => {
    if (settings) window.api.java.check(settings.javaPath).then(setJavaStatus);
  }, [settings?.javaPath]);

  function resetOrder() {
    window.api.settings.set({ sidebarOrder: [], instanceTabOrder: [] });
    window.dispatchEvent(new Event(ORDER_RESET_EVENT));
  }

  function updateSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set({ [key]: value });
  }

  // Several settings at once (a theme with its accent, the appearance reset).
  function updateSettings(partial) {
    const next = { ...settings, ...partial };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set(partial);
  }

  const [totalMem, setTotalMem] = useState(16384);
  const [memDraft, setMemDraft] = useState(null);
  useEffect(() => { window.api.system.totalMemoryMb().then(setTotalMem).catch(() => {}); }, []);
  const memCap = memoryCap(totalMem);

  function commitMemory() {
    if (memDraft == null) return;
    const max = memDraft;
    setMemDraft(null);
    const next = { ...settings, maxMemoryMb: max, minMemoryMb: Math.min(1024, max) };
    setSettings(next);
    onSettingsChange?.(next);
    window.api.settings.set({ maxMemoryMb: max, minMemoryMb: Math.min(1024, max) });
  }

  async function handleMicrosoftLogin() {
    setLoggingIn(true);
    setLoginError(null);
    const res = await window.api.auth.login();
    setLoggingIn(false);
    setLoginStatus(null);
    if (res.ok) onAccountChange(res.account);
    else setLoginError(res.error);
  }

  async function handleLogout() {
    // Removes the currently-active account. If other accounts are still
    // signed in, the backend switches to one of those instead of going
    // fully signed-out — re-fetch rather than assuming null.
    await window.api.auth.logout();
    const next = await window.api.auth.getAccount();
    onAccountChange(next);
  }

  if (!settings) return <div className="progress-label">Загрузка…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Настройки</h1>
      </div>

      <div className="settings-layout">
      <div className="settings-section settings-main">
      <h2 className="section-heading" style={{ marginTop: 0 }}>Аккаунт</h2>
      <p className="hint-text" style={{ marginTop: -8, marginBottom: 16 }}>
        Можно добавить несколько аккаунтов (и Microsoft, и оффлайн) и быстро переключаться между ними — нажмите на аватар в самом верху боковой панели.
        Оффлайн-аккаунтов до 5, основной тоже считается. Скины, плащи, сердечки и цвет ника Eternal работают только на основном оффлайн-аккаунте — том, у которого ник с сайта.
      </p>

      {account ? (
        <div className="account-card">
          <div className="account-card-avatar">
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AccountFace account={account} size={58} iconSize={24} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="account-card-name"><NickText name={account.name} /></div>
            <div className="account-card-type">
              {account.type === 'microsoft' ? 'Аккаунт Microsoft' : account.isMain ? 'Оффлайн-аккаунт · основной (ник с сайта)' : 'Оффлайн-аккаунт · скины и плащи Eternal не работают'}
            </div>
          </div>
          <PremiumButton />
          <button className="btn" onClick={handleLogout}><LogOutIcon width={16} height={16} /> Выйти</button>
        </div>
      ) : (
        <div>
          <button className="btn btn-primary" onClick={handleMicrosoftLogin} disabled={loggingIn}>
            {loggingIn ? (loginStatus || 'Вход…') : 'Войти через Microsoft'}
          </button>
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => setShowOffline((v) => !v)}>
            Оффлайн-аккаунт
          </button>
          {showOffline && (
            <div style={{ marginTop: 14, maxWidth: 360 }}>
              <OfflineAddForm onAdded={(acc) => { onAccountChange(acc); setShowOffline(false); }} />
            </div>
          )}
          {loginError && <div className="error-text" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{loginError}</div>}
        </div>
      )}

      <h2 className="section-heading">Площадки</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">CurseForge API-ключ</div>
          <div className="settings-row-desc">
            Нужен для поиска и установки модов/сборок с CurseForge. Бесплатный ключ —{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); window.api.shell.openExternal('https://console.curseforge.com/'); }}>
              console.curseforge.com
            </a>.
          </div>
          <button className="btn" style={{ marginTop: 10 }} onClick={checkCfKey} disabled={cfCheck?.busy || !cleanKey(cfKeyDraft)}>
            {cfCheck?.busy ? 'Проверяю…' : 'Проверить ключ'}
          </button>
        </div>
        <input
          value={cfKeyDraft}
          onChange={(e) => setCfKeyDraft(e.target.value)}
          onBlur={() => { const k = cleanKey(cfKeyDraft); setCfKeyDraft(k); updateSetting('curseforgeApiKey', k); }}
          placeholder="$2a$10…"
          type="password"
        />

      </div>

      {cfCheck && !cfCheck.busy && (
        <div className={cfCheck.ok ? 'hint-text' : 'error-text'} style={{ marginTop: -4, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{cfCheck.message}</div>
      )}

      <h2 className="section-heading">Discord</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Показывать активность в Discord</div>
          <div className="settings-row-desc">В профиле Discord будет видно, чем вы заняты: «Смотрит на сборки», «Ищет моды», «Играет» (с названием сборки) или «Бездельничает».</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.discordPresence !== false}
          onChange={(e) => updateSetting('discordPresence', e.target.checked)}
        />
      </div>

      <h2 className="section-heading">Производительность</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Экономить ресурсы в фоне</div>
          <div className="settings-row-desc">Когда окно лаунчера не в фокусе или свёрнуто (например, идёт игра), анимации, 3D-персонаж и размытие стекла отключаются и не нагружают видеокарту. При возвращении всё включается снова.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.pauseInBackground !== false}
          onChange={(e) => updateSetting('pauseInBackground', e.target.checked)}
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Частота анимаций</div>
          <div className="settings-row-desc">Для 3D-персонажа. 30 кадров/с вдвое легче для процессора и видеокарты, но чуть менее плавно. «Авто» — как у монитора. Используйте только на слабых ПК.</div>
        </div>
        <div className="gc-picker-row">
          {[[0, 'Авто'], [60, '60'], [30, '30']].map(([fps, label]) => (
            <button key={fps} type="button" className={`shot-editor-tool ${(settings.animationFps || 0) === fps ? 'active' : ''}`} onClick={() => updateSetting('animationFps', fps)}>{label}</button>
          ))}
        </div>
      </div>

      {SHOW_OVERLAY_SETTINGS && (
      <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Оверлей мониторинга</div>
          <div className="settings-row-desc">В игре по выбранной клавише поверх окна появляется панель: FPS, график кадров, процессор, видеокарта, память, сущности, TPS. Работает в Minecraft 26.1+ (нужен агент Eternal Cosmetics) и в Horizon (Rust). В оконном режиме и «окно без рамки». Клавишу меняйте до запуска игры.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.overlayEnabled !== false}
          onChange={(e) => updateSetting('overlayEnabled', e.target.checked)}
        />
      </div>
      {settings.overlayEnabled !== false && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Клавиша оверлея</div>
            <div className="settings-row-desc">Нажатие показывает и скрывает панель.</div>
          </div>
          <div className="gc-picker-row" style={{ flexWrap: 'wrap', maxWidth: 360 }}>
            {[['f9', 'F9'], ['f8', 'F8'], ['insert', 'Insert'], ['home', 'Home'], ['end', 'End'], ['right_ctrl', 'Right Ctrl'], ['right_shift', 'Right Shift'], ['right_alt', 'Right Alt']].map(([id, label]) => (
              <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayKey || 'f9') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayKey', id)}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {settings.overlayEnabled !== false && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Вид оверлея</div>
              <div className="settings-row-desc">Полный: FPS, график, процессор, видеокарта, память, мир. Компактный: только FPS и график.</div>
            </div>
            <div className="gc-picker-row">
              {[['full', 'Полный'], ['compact', 'Компактный']].map(([id, label]) => (
                <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayMode || 'full') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayMode', id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Размер и положение</div>
              <div className="settings-row-desc">Применяется, когда панель показывается заново.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <div className="gc-picker-row">
                {[['small', 'Мелкий'], ['normal', 'Обычный'], ['large', 'Крупный']].map(([id, label]) => (
                  <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayScale || 'normal') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayScale', id)}>{label}</button>
                ))}
              </div>
              <div className="gc-picker-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {[['tl', 'Слева сверху'], ['tr', 'Справа сверху'], ['bl', 'Слева снизу'], ['br', 'Справа снизу']].map(([id, label]) => (
                  <button key={id} type="button" className={`shot-editor-tool ${(settings.overlayCorner || 'tl') === id ? 'active' : ''}`} onClick={() => updateSetting('overlayCorner', id)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Прозрачность панели</div>
              <div className="settings-row-desc">{settings.overlayOpacity ?? 82}%: чем меньше, тем лучше видна игра под панелью.</div>
            </div>
            <input
              type="range" className="mem-range" style={{ width: 200 }}
              min={40} max={100} step={5}
              value={settings.overlayOpacity ?? 82}
              onChange={(e) => updateSetting('overlayOpacity', Number(e.target.value))}
            />
          </div>
        </>
      )}
      </>
      )}

      <h2 className="section-heading">Косметика</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Наша косметика</div>
          <div className="settings-row-desc">Плащи, скины, цвет ника и сердечки игроков Eternal: вы видите их, а они видят ваши.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={settings.eternalCosmetics !== false}
          onChange={(e) => updateSetting('eternalCosmetics', e.target.checked)}
        />
      </div>
      <MasterOptionsSettings />
      <SharedServersSettings />
      <FoldersSettings />

      <h2 className="section-heading">Java</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Путь к Java</div>
          <div className="settings-row-desc">
            {javaStatus?.ok ? `Найдена Java ${javaStatus.version}` : 'Java не найдена — оставьте пустым, чтобы использовать PATH, либо укажите путь к javaw.exe'}
          </div>
        </div>
        <input
          value={settings.javaPath}
          onChange={(e) => updateSetting('javaPath', e.target.value)}
          placeholder="java"
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Оперативная память по умолчанию</div>
          <div className="settings-row-desc">
            Столько памяти получает каждая сборка, у которой нет своего значения. Для отдельной сборки можно задать своё в её настройках.
            Всего на устройстве: {formatMb(totalMem)}.
          </div>
        </div>
        <div style={{ width: 260 }}>
          <div className="memory-slider-head"><span /> <strong>{formatMb(memDraft ?? settings.maxMemoryMb)}</strong></div>
          <input
            type="range" className="mem-range"
            min={MEM_FLOOR} max={memCap} step={MEM_STEP}
            value={Math.min(memDraft ?? settings.maxMemoryMb, memCap)}
            onChange={(e) => setMemDraft(Number(e.target.value))}
            onMouseUp={commitMemory} onTouchEnd={commitMemory} onKeyUp={commitMemory}
          />
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Сборщик мусора</div>
          <div className="settings-row-desc">Для всех сборок. G1GC — стандартный, ZGC — почти без пауз на больших сборках (нужна Java 15+, на старой Java отключится сам). В настройках сборки можно выбрать своё.</div>
        </div>
        <GcPicker args={settings.javaArgs} onChange={(v) => updateSetting('javaArgs', v)} compact />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row-label">Доп. аргументы JVM</div>
          <div className="settings-row-desc">Применяются ко всем сборкам.</div>
        </div>
        <input
          value={settings.javaArgs}
          onChange={(e) => updateSetting('javaArgs', e.target.value)}
          placeholder="-XX:+UseG1GC"
        />
      </div>

      <h2 className="section-heading">О лаунчере</h2>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Версия</div>
          <div className="settings-row-desc">Текущая версия: {appVersion || '…'}</div>
        </div>
      </div>
      {license?.valid && !license.dev && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Аккаунт</div>
            <div className="settings-row-desc">Твой аккаунт Eternal.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <strong>{license.username}</strong>
            <button
              className="btn"
              onClick={() => { if (window.confirm('Выйти из аккаунта сайта? Лаунчер закроется до нового входа.')) window.api.license.logout(); }}
            >
              Выйти
            </button>
          </div>
        </div>
      )}
      <div className="settings-row-block">
        {['available', 'downloading', 'ready', 'installing'].includes(updater.status) ? (
          <p style={{ color: 'var(--success)', fontSize: 13 }}>
            Доступна версия {updater.info?.latest} (у вас {updater.info?.current}). Кнопки — в карточке справа внизу.
          </p>
        ) : (
          <button className="btn" onClick={updater.check} disabled={updater.status === 'checking'}>
            {updater.status === 'checking' ? 'Проверка…' : 'Проверить обновления'}
          </button>
        )}
        {updater.status === 'uptodate' && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 10 }}>У вас последняя версия ({updater.info?.current}).</p>
        )}
        {updater.status === 'off' && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 10 }}>Адрес сервера обновлений в этой сборке не задан.</p>
        )}
        {updater.status === 'error' && !updater.info?.hasUpdate && (
          <p className="error-text" style={{ marginTop: 10 }}>Не удалось проверить обновления: {updater.error}</p>
        )}
      </div>
      </div>

      <div className="settings-side">
        <h2 className="section-heading" style={{ marginTop: 0 }}>Интерфейс</h2>
        <div className="ui-columns">
        <div className="ui-group">
          <div className="ui-group-title">Стиль оформления</div>
          <div className="style-picker">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`style-card ${(settings.interfaceStyle || 'classic') === opt.id ? 'active' : ''}`}
                onClick={() => updateSetting('interfaceStyle', opt.id)}
              >
                <div className={`style-card-preview ${opt.id}`}>
                  <span className="style-card-preview-bar" />
                  <span className="style-card-preview-chip" />
                </div>
                <div className="style-card-name">{opt.name}</div>
                <div className="style-card-desc">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <AppearanceSettings settings={settings} updateSetting={updateSetting} updateSettings={updateSettings} />
        {INTERFACE_GROUPS.map((group) => (
          <div className="ui-group" key={group.title}>
            <div className="ui-group-title">{group.title}</div>
            <div className="ui-toggle-grid">
              {group.items.map((item) => {
                const on = item.get(settings);
                return (
                  <label className="ui-toggle" key={item.key}>
                    <div className="ui-toggle-text">
                      <div className="ui-toggle-label">{item.label}</div>
                      <div className="ui-toggle-desc">{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      className="switch small"
                      checked={on}
                      onChange={(e) => updateSetting(item.key, item.set(e.target.checked))}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <div className="ui-group">
          <div className="ui-group-title">Порядок вкладок</div>
          <div className="ui-toggle-desc" style={{ marginBottom: 10 }}>
            Перетаскивайте иконки в боковой панели и вкладки внутри сборки (Контент, Файлы, Миры…), чтобы поменять их местами.
          </div>
          <button className="btn" onClick={resetOrder}>Сбросить порядок</button>
        </div>
        <div className="ui-group">
          <div className="ui-group-title">Горячие клавиши</div>
          <div className="ui-toggle" style={{ cursor: 'default' }}>
            <div className="ui-toggle-text">
              <div className="ui-toggle-label">Командная палитра</div>
              <div className="ui-toggle-desc">Быстрый переход к разделу или сборке.</div>
            </div>
            <KeybindRecorder
              value={settings.keybindings?.commandPalette || DEFAULT_KEYBINDINGS.commandPalette}
              onChange={(b) => updateSetting('keybindings', { ...settings.keybindings, commandPalette: b })}
              onReset={() => updateSetting('keybindings', { ...settings.keybindings, commandPalette: DEFAULT_KEYBINDINGS.commandPalette })}
            />
          </div>
        </div>
        </div>
      </div>
      </div>

      <div className="authors">
        <div className="authors-title">Авторы:</div>
        <div className="authors-row">
          {AUTHORS.map((a) => (
            <div className="author" key={a.name} data-name={a.name}>
              <SkinFace src={a.skin} size={56} className="author-head" />
            </div>
          ))}
        </div>
        {SUPPORTERS.length > 0 && (
          <>
            <div className="authors-sub">Поддержали лаунчер</div>
            <div className="authors-row">
              {SUPPORTERS.map((p, i) => (
                <div className="author" key={`${p.name}:${i}`} data-name={p.name || undefined}>
                  <SkinFace src={p.skin} size={56} className="author-head" />
                </div>
              ))}
            </div>
          </>
        )}
        <details className="credits">
          <summary>Лицензии и источники</summary>
          <div className="credits-body">
            <p>
              <strong>Horizon</strong> — Minecraft на Rust, проект{' '}
              <button type="button" className="credits-link" onClick={() => window.api.shell.openExternal('https://github.com/horizon-rust/horizon')}>horizon-rust/horizon</button>,
              лицензия LGPL-3.0. Лаунчер не включает Horizon в себя: он скачивает официальные сборки с GitHub и запускает их отдельной программой.
            </p>
            <p><strong>Каталоги модов</strong> — Modrinth и CurseForge, через их публичные API.</p>
            <p><strong>Minecraft</strong> — файлы игры скачиваются с серверов Mojang. Лаунчер не является официальным продуктом Minecraft, не одобрен Mojang или Microsoft и не связан с ними.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

// Click "Записать", press the combo you want, done — Esc alone cancels
// without changing anything.
function KeybindRecorder({ value, onChange, onReset }) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return undefined;
    function onKeyDown(e) {
      e.preventDefault();
      // Consume the whole keystroke here — otherwise, once this recorder's
      // own state update takes effect, the very same keydown can go on to
      // bubble into whatever listener the *new* binding now matches (e.g.
      // it would immediately toggle the command palette while recording a
      // binding for it), because React can re-render before the bubble
      // phase reaches window.
      e.stopPropagation();
      if (e.code === 'Escape') { setRecording(false); return; }
      const next = captureBinding(e);
      if (next) { onChange(next); setRecording(false); }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="keybind-recorder">
      <button type="button" className={`keybind-value ${recording ? 'recording' : ''}`} onClick={() => setRecording(true)}>
        {recording ? 'Нажмите клавиши…' : formatBinding(value)}
      </button>
      <button className="btn-text" onClick={() => { setRecording(false); onReset(); }}>Сбросить</button>
    </div>
  );
}
