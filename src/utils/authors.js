// Настройки → внизу «Авторы». Скины лежат в src/assets/authors/ (supporter-<имя>.png), список людей — в SUPPORTERS ниже.
// Голова рисуется из скина вместе со вторым слоем (как аватарка аккаунта в боковой панели).
// Скины поддержавших (supporter-*.png) не входят в репозиторий: если файла нет, показывается заглушка,
// и лаунчер всё равно собирается. Скины самих авторов — в репозитории.
import mihalych from '../assets/authors/mihalych.png';
import thewolf1k from '../assets/authors/thewolf1k.png';
import claude from '../assets/authors/claude.png';
import placeholder from '../assets/authors/placeholder.png';

// Все найденные файлы supporter-*.png (пусто, если их нет): имя файла без пути → адрес картинки
const found = import.meta.glob('../assets/authors/supporter-*.png', { eager: true, import: 'default' });
const supporterSkin = (file) => found[`../assets/authors/${file}.png`] || placeholder;

export const AUTHORS = [
  { name: 'Михалыч', skin: mihalych },
  { name: 'TheWolf1k', skin: thewolf1k },
  { name: 'Claude', skin: claude }, // ИИ, который писал этот лаунчер вместе с Михалычем
];

// файлы: supporter-streltsy (Vitality0zersk), supporter-2 (3JIbqo); у daslan1882 был только лицо (скин собран из него),
// у stRaDAt3L скина нет (анонимный скин со знаком вопроса)
export const SUPPORTERS = [
  { name: 'Vitality0zersk', skin: supporterSkin('supporter-streltsy') },
  { name: '3JIbqo', skin: supporterSkin('supporter-2') },
  { name: 'kerrigannn', skin: supporterSkin('supporter-kerrigannn') },
  { name: 'Alstar', skin: supporterSkin('supporter-alstar') },
  { name: 'suchnothing', skin: supporterSkin('supporter-suchnothing') },
  { name: 'DeL1TMe', skin: supporterSkin('supporter-del1tme') },
  { name: 'ksl44', skin: supporterSkin('supporter-ksl44') },
  { name: 'Emofeq', skin: supporterSkin('supporter-emofeq') },
  { name: 'rdvtrdrdrtdry', skin: supporterSkin('supporter-rdvtrdrdrtdry') },
  { name: 'daslan1882', skin: supporterSkin('supporter-daslan1882') },
  { name: '1van0vskiy', skin: supporterSkin('supporter-1van0vskiy') },
  { name: 'A2MO', skin: supporterSkin('supporter-a2mo') },
  { name: 'stRaDAt3L', skin: supporterSkin('supporter-stradat3l') },
  { name: 'Fr1x', skin: supporterSkin('supporter-fr1x') },
  { name: 'Lucif_fer', skin: supporterSkin('supporter-lucif-fer') },
  { name: 'Vanya_23', skin: supporterSkin('supporter-vanya23') },
];
