#!/usr/bin/env node
/**
 * add-locale-keys.js
 *
 * Adds missing translation keys from patches.json to ru.json and en.json.
 * Safe to re-run: never overwrites existing keys.
 *
 * Usage:
 *   node tools/add-locale-keys.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Russian + English translations for every key used in patches.json ─────────
// Format: key: [ru, en]
const TRANSLATIONS = {
  // Navigation
  'ui.nav.tasks':              ['Задачи',      'Tasks'],
  'ui.nav.leisure':            ['Досуг',        'Leisure'],
  'ui.nav.skills':             ['Навыки',       'Skills'],
  'ui.nav.hardware':           ['Техника',      'Hardware'],

  // Common
  'ui.common.settings':        ['Настройки',   'Settings'],
  'ui.common.back':            ['Назад',        'Back'],
  'ui.common.close':           ['Закрыть',      'Close'],
  'ui.common.cancel':          ['Отмена',       'Cancel'],

  // Exit overlay
  'ui.exit.button':                    ['Выход в меню',                          'Exit to Menu'],
  'ui.exit.autosave-text':             ['Игра автоматически сохранена в начале дня.', 'The game is automatically saved at the start of each day.'],
  'ui.exit.save-unavailable':          ['В данной версии сохранение не доступно',     'Saving is not available in this version'],
  'ui.exit.progress-reset':            ['Весь прогресс будет сброшен',               'All progress will be reset'],
  'ui.exit.confirm-button':            ['Выйти',                                     'Exit'],
  'ui.exit.unsaved-progress-warning':  ['Несохраненный прогресс будет потерян',       'Unsaved progress will be lost'],
  'ui.exit.cancel-button':             ['Продолжить игру',                            'Continue Playing'],

  // Glossary – tasks
  'ui.glossary.task-title':         ['Название задачи',                                                  'Task Name'],
  'ui.glossary.task-description':   ['Описание задачи',                                                  'Task Description'],
  'ui.glossary.task-success-rate':  ['Вероятность успешного выполнения\nзадачи без бага',                'Probability of completing\na task without a bug'],
  'ui.glossary.task-morale-benefit':['Задачи хорошо влияют на мотивацию\nи повышение навыков',          'Tasks boost morale\nand help level up skills'],
  'ui.glossary.task-costs-energy':  ['Задачи не делаются мгновенно.\nИх выполнение отнимает энергию.',  'Tasks take time.\nCompleting them costs energy.'],
  'ui.glossary.task-failure-morale':['А создавать баги — не очень...\nВ случае провала мотивация падает', 'Creating bugs is no fun...\nOn failure, morale drops'],
  'ui.glossary.task-success-morale':['Делать задачи без ошибок радостно!\nВ случае успеха мотивация растёт.', 'Completing tasks without bugs feels great!\nOn success, morale grows.'],

  // Glossary – bugs
  'ui.glossary.bug-title':           ['Название бага',                                                   'Bug Name'],
  'ui.glossary.bug-description':     ['Описание бага',                                                   'Bug Description'],
  'ui.glossary.bug-success-rate':    ['Вероятность успешного фикса\nРастёт с каждой попыткой',           'Fix success rate\ngrows with each attempt'],
  'ui.glossary.bug-morale-penalty':  ['Баги негативно влияют на мотивацию\nи хуже задач развивают навыки', 'Bugs hurt morale\nand develop skills slower than tasks'],
  'ui.glossary.bug-energy-decreases':['С каждой попыткой баг всё проще\nЗатраты энергии падают',        'Each attempt makes the bug easier\nEnergy cost decreases'],
  'ui.glossary.bug-failure-morale':  ['Ещё и переделывать?!\nВ случае провала падает ещё сильнее',      'Fix it again?!\nOn failure, morale drops even more'],
  'ui.glossary.bug-success-morale':  ['Ага, ура, починил...\nВ случае успеха мотивация всё равно падает', 'Fixed it at last...\nOn success, morale still drops a little'],

  // Glossary – morale
  'ui.glossary.morale-indicator-location': ['Индикатор мотивации расположен наверху справа',          'The morale indicator is in the top right'],
  'ui.glossary.morale-indicator-click':    ['Значение появляется при нажатии на индикатор',            'The value appears when you tap the indicator'],
  'ui.glossary.morale-threshold':          ['Мотивация >= 50',                                         'Morale >= 50'],
  'ui.glossary.morale-affects-tasks':      ['Мотивация влияет на шанс успешного выполнения задачи',    'Morale affects the chance of completing a task successfully'],
  'ui.glossary.morale-threshold-effect':   ['Эффект мотивации проявляется при определённом значении',  'Morale effects activate at certain thresholds'],

  // Career / header
  'ui.career.next-label':    ['Следующий:',    'Next:'],
  'ui.career.days-to-review':['До аттестации:','Until review:'],
  'ui.career.day-label':     ['День:',          'Day:'],

  // Glossary – requirements (user-defined keys)
  'ui.glossary.requirements.certain': ['Определённый навык не ниже 9', 'Specific skill at level 9+'],
  'ui.glossary.requirements.sum':     ['Суммарный уровень навыков',    'Total skill level'],

  // Glossary – career hints
  'ui.glossary.career-hint-any-skill':         ['Подсказки показывают ближайшие\nнавыки к требованиям, но можно\nпрокачивать и другие',          'Hints show the closest skills\nto requirements, but you can\nlevel up any skills'],
  'ui.glossary.career-hint-all-requirements':  ['Нужно выполнить все требования',                                                                 'You must meet all requirements'],
  'ui.glossary.career-hint-review-timing':     ['Аттестация происходит после\nсна, когда счётчик показал 0',                                     'Review happens after sleep,\nwhen the counter reaches 0'],

  // Glossary – requirement type labels & descriptions
  'ui.glossary.career-req-specific-skill-label':['Определённый навык не ниже 9',                                                           'Specific skill at level 9+'],
  'ui.glossary.career-req-specific-skill-desc': ['— будут указаны конкретные навыки, каждый нужно докачать до указанного уровня',           '— specific skills will be listed; each must be leveled to the required level'],
  'ui.glossary.career-req-total-skills-label':  ['Суммарный уровень навыков',                                                              'Total skill level'],
  'ui.glossary.career-req-total-skills-desc':   ['— сумма уровней всех навыков должна достичь заданной величины. Навыки любые.',           '— the sum of all skill levels must reach the target. Any skills count.'],
  'ui.glossary.career-req-any-skill-label':     ['Любой навык не ниже 7',                                                                  'Any skill at level 7+'],
  'ui.glossary.career-req-any-skill-desc':      ['— нужно прокачать указанное количество навыков до заданного уровня.',                    '— you need to level up the specified number of skills to the required level.'],

  // Goal screen
  'ui.goal.title':        ['Цель игры:',              'Game Goal:'],
  'ui.goal.text':         ['Достичь должности\nархитектора', 'Reach the position\nof Architect'],
  'ui.goal.start-button': ['У меня получится!',       "I can do this!"],

  // Intro
  'ui.intro.slide-1':           ['Меня всегда тянуло к компьютеру...',                                    "I've always been drawn to computers..."],
  'ui.intro.slide-2':           ['Хотя знакомство задалось не сразу',                                     "Though it didn't click right away"],
  'ui.intro.slide-3':           ['И какое-то время вело не туда',                                         "And for a while it led me astray"],
  'ui.intro.slide-4':           ['Но уже в школе я понял, что хочу стать',                               "But in school I realized what I wanted to become"],
  'ui.intro.slide-5':           ['В университете мои знания крепли, я любил помогать друзьям',            "At university my skills grew — I loved helping friends"],
  'ui.intro.slide-6':           ['И вот, к концу учёбы, я нашёл отличное место для стажировки!',         "And at the end of my studies, I found a great internship!"],
  'ui.intro.direction-frontend':['Фронтендером',   'A Frontend Developer'],
  'ui.intro.direction-backend': ['Бэкендером',     'A Backend Developer'],

  // Main menu
  'ui.main-menu.game-title':     ['Симулятор\nПрограммиста', 'Programmer\nSimulator'],
  'ui.main-menu.new-game':       ['Начать игру',             'New Game'],
  'ui.main-menu.continue-game':  ['Продолжить игру',         'Continue'],

  // Slot selection
  'ui.slot-selection.header':           ['Выберите ячейку сохранения',                    'Choose a Save Slot'],
  'ui.slot-selection.confirm-overwrite':['Вы хотите перезаписать сохранение в ячейке?',   'Do you want to overwrite this save slot?'],
  'ui.slot-selection.confirm-yes':      ['Да, перезаписать',                              'Yes, overwrite'],
  'ui.slot-selection.confirm-no-undo':  ['Нельзя будет отменить',                        'This cannot be undone'],

  // Task progress
  'ui.task.progress.title': ['Задача', 'Task'],

  // Skill requirement prefab (text set by code — key is a safe default)
  'ui.skill.requirement.any.title': ['Любой навык не ниже 0', 'Any skill at level 0+'],

  // Confirm prefab (text set by code — keys provide a safe default)
  'ui.confirm.question':   ['Вы можете пригласить друзей в игру',                   'You can invite friends to the game'],
  'ui.confirm.close':      ['Закрыть',      'Close'],
  'ui.confirm.title':      ['Согласиться',  'Agree'],
  'ui.confirm.disclaimer': ['Это не даст бонусов, зато будет с кем обсудить результат', 'No bonuses, but you will have someone to share results with'],

  // Error prefab
  'ui.error.title':       ['Ошибка!',             'Error!'],
  'ui.error.description': ['Что-то пошло не так...', 'Something went wrong...'],
  'ui.error.action':      ['Попробуйте ещё раз.',  'Please try again.'],

  // Failure screen
  'ui.failure.fired-text': ['Вас уволили!\nВы не успели повыситься вовремя.', "You were fired!\nYou didn't get promoted in time."],
  'ui.failure.exit-button':['Выход', 'Exit'],

  // Footer
  'ui.footer.sleep-button': ['Спать', 'Sleep'],

  // Header career placeholders (overridden by PlayerLevelComponent at runtime)
  'ui.header.career.current': ['Стажер',            'Trainee'],
  'ui.header.career.next':    ['Следующий уровень',  'Next Level'],

  // Rewarded ad
  'ui.rewarded-ad.per-view':  ['за просмотр',              'per view'],
  'ui.rewarded-ad.loading':   ['Загрузка рекламы...',      'Loading ad...'],
  'ui.rewarded-ad.disclaimer':['Просмотр рекламы не обязателен', 'Watching ads is optional'],

  // Leisure prefab (title set by code)
  'ui.leisure.title': ['Название', 'Name'],

  // Loader prefab (status set by code)
  'ui.loader.title':  ['Загрузка...',         'Loading...'],
  'ui.save.loader':   ['Загружаем ресурсы...','Loading resources...'],

  // Onboarding
  'ui.onboarding.useful-info':                   ['Полезная информация',                                                                                     'Useful Information'],
  'ui.onboarding.bug.intro-text':                ['Баги только на доске мешаются! Починю, когда с задачами закончу...',                                      'Bugs just clutter the board! I\'ll fix them after I\'m done with tasks...'],
  'ui.onboarding.career.intro-text':             ['Ну как, освоился? Я составил для тебя план на стажировку, ты его найдёшь на своём рабочем месте.',        'So, settling in? I\'ve prepared an internship plan for you — you\'ll find it at your workstation.'],
  'ui.onboarding.career.hint-optional-skills':   ['Не обязательно развивать эти\nНо они ближе всех к требуемому',                                           'You don\'t have to level these\nbut they\'re closest to the requirements'],
  'ui.onboarding.career.hint-required-skills':   ['Повышение зависит от навыков\nТут приведён список необходимых',                                          'Promotion depends on skills\nHere\'s the list of required ones'],
  'ui.onboarding.career.hint-review-timing':     ['В компании есть стандарты\nЧерез 6 дней подведём итоги',                                                 'The company has standards\nIn 6 days we\'ll review your progress'],
  'ui.onboarding.task.intro-text':               ['Для начала следует тут во всём разобраться. Мне предстоит делать задачи с этой доски.',                  'First I need to figure everything out here. I\'ll be working on tasks from this board.'],

  // Performance review
  'ui.performance-review.title':             ['Аттестация',        'Performance Review'],
  'ui.performance-review.exit-button':       ['В главное меню',    'Main Menu'],
  'ui.performance-review.continue-button':   ['Ура! Продолжим',    'Hooray! Let\'s continue'],
  'ui.performance-review.win-text':          ['Победа!',           'Victory!'],
  'ui.performance-review.win-exit-button':   ['Выйти в меню',      'Exit to Menu'],
  'ui.performance-review.win-continue-button':['Продолжить играть', 'Keep Playing'],

  // Save prefab (values set by code at runtime)
  'ui.save.title': ['Ячейка',  'Slot'],
  'ui.save.day':   ['День:',   'Day:'],
  'ui.save.empty': ['Пусто',   'Empty'],

  // Settings
  'ui.settings.animations':     ['Анимации',        'Animations'],
  'ui.settings.onboarding':     ['Обучение',         'Tutorial'],
  'ui.settings.version':        ['Версия',           'Version'],
  'ui.settings.language':       ['Язык',             'Language'],
  'ui.settings.language-auto':  ['Автоматически',    'Auto'],

  // Attitude overlay
  'ui.attitude.header':          ['Мне начинает нравиться делать задачи в сфере:', 'I\'m starting to enjoy tasks in the field of:'],
  'ui.attitude.instruction':     ['Следует выбрать 2 сферы',                       'Choose 2 areas'],
  'ui.attitude.confirm-button':  ['Точно эти!',                                    'These for sure!'],

  // Skill & task prefab placeholders (content set by code)
  'ui.skill.name':       ['Навык',  'Skill'],
  'ui.task.title':       ['Задача', 'Task'],
  'ui.task.description': ['Описание задачи', 'Task description'],
};

// ── Load locale files ─────────────────────────────────────────────────────────
const ruPath = path.join(ROOT, 'assets/resources/data/locale/ru.json');
const enPath = path.join(ROOT, 'assets/resources/data/locale/en.json');

const ru = JSON.parse(fs.readFileSync(ruPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// ── Add missing keys ──────────────────────────────────────────────────────────
let addedCount = 0;
for (const [key, [ruVal, enVal]] of Object.entries(TRANSLATIONS)) {
  if (!ru[key]) { ru[key] = ruVal; addedCount++; }
  if (!en[key]) { en[key] = enVal; }
}

// ── Write ─────────────────────────────────────────────────────────────────────
fs.writeFileSync(ruPath, JSON.stringify(ru, null, 2) + '\n', 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

console.log(`Added ${addedCount} new keys to locale files.`);
console.log(`ru.json: ${Object.keys(ru).length} total keys`);
console.log(`en.json: ${Object.keys(en).length} total keys`);
