/**
 * What the mascot says, by language → character → topic.
 * Tokens: {me} — the hero's name, {laugh} — his laugh, {name} — the person's name.
 * Russian lines avoid gendered verbs about the person (we do not know who reads).
 */
export type Mood = 'classic' | 'jolly' | 'fairy' | 'grumpy';
export type Topic =
  'greet' | 'tip' | 'rules' | 'teaser' | 'install' | 'write' | 'gift' | 'midnight';

type Lines = Record<Topic, string[]>;

const ru: Record<Mood, Lines> = {
  classic: {
    greet: [
      '{laugh}! Здравствуй, {name}! Рад тебя видеть.',
      'А вот и ты, {name}! Ёлка уже ждёт новых шаров.',
      'Здравствуй, {name}! До Нового года всё ближе — самое время для добрых слов.',
    ],
    tip: [
      'Каждое поздравление — шар на твоей ёлке. А в новогоднюю ночь он загорится!',
      'Позови друзей: за каждого на гирлянде зажжётся огонёк.',
      'Мандаринки не купить — только заработать добрыми делами. Загляни в лавку!',
      'Нажми на домик — можно примерить гирлянду на крыше.',
      'Звезда на макушке загорится, когда ты откроешь свой подарок.',
      'Чем выше уровень праздника, тем наряднее двор: фонари, паровозик, северное сияние…',
    ],
    rules: ['Сейчас всё расскажу по порядку. Правила простые, а радости — на целый год!'],
    teaser: ['Здравствуй! Я {me}. Хочешь, расскажу, как тут всё устроено? Это минута, не больше.'],
    install: [
      'Поставь меня на главный экран — буду рядом в одно касание, и полночь не пропустишь.',
    ],
    write: [
      'Пиши от сердца — так, как хотелось бы прочитать самому.',
      'Пара тёплых строк может согреть кого-то на другом конце света.',
    ],
    gift: ['{laugh}! Тебе подарок! Скорее открывай!'],
    midnight: ['Подарок придёт ровно в полночь по твоему времени. Я прослежу!'],
  },
  jolly: {
    greet: [
      'Йоу, {name}! {me} на связи 🤙',
      'О, {name}, ты вовремя. Вайб уже новогодний, осталось добавить шаров.',
      'Хэй, {name}! Ёлка без твоих шаров — ну такое, кринж.',
    ],
    tip: [
      'Лайфхак: каждое поздравление = шар на ёлке. Больше шаров — больше флекса.',
      'Зови друзей — каждый друг это огонёк на гирлянде. Гирлянда за друзей — имба.',
      'Мандаринки не донатятся, только фармятся добрыми делами. Честно, без читов 🍊',
      'Тапни на домик — там гирлянды можно примерить. Бесплатно, без регистрации и смс 😎',
      'Звезда на ёлке загорится, когда откроешь подарок. Спойлер: это будет рил момент.',
      'Апнешь уровень праздника — во дворе поедет паровозик. Чух-чух, без б.',
    ],
    rules: ['Короче, объясняю на пальцах. Правила изи, скроль 👇'],
    teaser: ['Йоу! Я {me}, местный гид. Объяснить правила за минуту? Без душноты, обещаю.'],
    install: ['Закинь меня на главный экран — и я всегда под рукой. Полночь не проспишь, рил.'],
    write: [
      'Пиши как другу, без официоза. Кринж — не страшно, искренность решает.',
      'Пара строк от души — и у кого-то на другом конце планеты лучший вайб года.',
    ],
    gift: ['ОМГ, тебе подарок пришёл! Открывай, не томи 🎁'],
    midnight: [
      'Подарок прилетит ровно в 00:00 по твоему времени. Ставь будильник, ну или просто доверься мне.',
    ],
  },
  fairy: {
    greet: [
      'Здравствуй, {name}! Заходи, присаживайся у ёлочки — сказка начинается.',
      'Гость дорогой в терем пожаловал! Здравствуй, {name}: метель поёт, ёлка ждёт.',
      'Жили-были добрые слова, да всё ждали, кто их напишет… Здравствуй, {name}!',
    ],
    tip: [
      'Каждое доброе слово — шар хрустальный на ёлке. А в ночь новогоднюю засияет он ярче звёзд.',
      'Позови друзей-товарищей: за каждого гирлянда огоньком зажжётся.',
      'Мандаринки за золото не купишь — только добрыми делами добудешь. Таков уговор.',
      'Постучи в избушку — гирлянды на крыше примерить можно.',
      'Как откроешь свой подарок, так и звезда на макушке вспыхнет.',
      'Чем веселее праздник, тем чудеснее двор: и паровозик приедет, и сияние северное заиграет.',
    ],
    rules: ['Слушай же, как в нашей сказке всё заведено…'],
    teaser: ['Здравствуй, путник! Я {me}. Поведать тебе, как в нашей сказке всё устроено?'],
    install: [
      'Поставь мой терем на главный экран — дорога ко мне станет короче, а полночь не проспишь.',
    ],
    write: [
      'Пиши, как письмо в сказку: от сердца, с теплом — и слова сами найдутся.',
      'Пошлёшь доброе слово за тридевять земель — оно к кому-то чудом вернётся.',
    ],
    gift: ['Чу! Подарок у порога! Развязывай скорее ленточку…'],
    midnight: ['Как пробьют часы полночь в твоих краях — так подарок и явится.'],
  },
  grumpy: {
    greet: [
      'А, {name}. Опять ты. Ну… проходи. Рад, конечно. Немножко.',
      '{name}, ну наконец-то. Ёлка сама себя не украсит, знаешь ли.',
      'Ох, спина… Здравствуй, {name}. Шары-то где? Шучу. Напиши хоть одно поздравление.',
    ],
    tip: [
      'Каждое поздравление — шар на ёлке. Я их, между прочим, сам вешаю. Вручную.',
      'Друзей позови. Каждому — огонёк на гирлянде. Мне лампочки менять, но ладно уж.',
      'Мандаринки не продаются. Я проверял — не продаются. Только добрыми делами.',
      'На домик нажми — гирлянды примерить можно. Только не трогай мою любимую.',
      'Звезда загорится, когда подарок откроешь. Не раньше. Не проси.',
      'Поднимешь уровень праздника — пущу паровозик. Шумный он… но красивый.',
    ],
    rules: ['Правила. Да-да, правила. Читай внимательно, повторять не буду. Ну… может, разок.'],
    teaser: [
      'Я {me}. Все спрашивают, как тут всё устроено. Ладно, объясню. Одну минуту, не больше.',
    ],
    install: ['Поставь меня на главный экран, что ли. Хоть искать не придётся каждый раз.'],
    write: [
      'Пиши по-доброму. Ворчать — это моя работа.',
      'Только без «счастья, здоровья» под копирку. Придумай что-нибудь своё, а?',
    ],
    gift: ['Ну что стоишь? Подарок пришёл. Открывай, я его не для красоты нёс.'],
    midnight: ['Подарок будет в полночь по твоему времени. Ни минутой раньше. Я пунктуальный.'],
  },
};

const en: Record<Mood, Lines> = {
  classic: {
    greet: [
      '{laugh}! Hello, {name}! Lovely to see you.',
      'There you are, {name}! The tree is waiting for new baubles.',
      'Hello, {name}! The New Year is getting closer — the perfect time for kind words.',
    ],
    tip: [
      'Every greeting is a bauble on your tree. On New Year’s night it lights up!',
      'Invite friends: every one of them lights a bulb on the garland.',
      'Mandarins can’t be bought — only earned by good deeds. Have a look at the shop!',
      'Tap the cabin to try on the lights on its roof.',
      'The star on top lights up when you open your own gift.',
      'The higher the festive level, the merrier the yard: lanterns, a little train, northern lights…',
    ],
    rules: [
      'Let me tell you everything in order. The rules are simple, and the joy lasts a whole year!',
    ],
    teaser: ['Hello! I’m {me}. Shall I explain how everything works here? It takes a minute.'],
    install: ['Put me on your home screen — I’ll be one tap away, and you won’t miss midnight.'],
    write: [
      'Write from the heart — the way you’d love to read it yourself.',
      'A couple of warm lines can warm someone on the other side of the world.',
    ],
    gift: ['{laugh}! A gift for you! Open it, quick!'],
    midnight: ['Your gift arrives exactly at midnight in your time zone. I’ll make sure of it!'],
  },
  jolly: {
    greet: [
      'Yo, {name}! {me} here 🤙',
      'Oh hey {name}, perfect timing. The vibe is festive, just add baubles.',
      'Hey {name}! A tree without your baubles? Lowkey sad.',
    ],
    tip: [
      'Pro tip: every greeting = a bauble on your tree. More baubles, more flex.',
      'Invite your friends — every friend is a light on the garland. Absolute W.',
      'Mandarins can’t be bought, only farmed with good deeds. No cheats, no cap 🍊',
      'Tap the cabin to try on the roof lights. Free, no sign-up 😎',
      'The star lights up when you open your gift. Spoiler: it hits different.',
      'Level up the party and a little train starts rolling in the yard. Choo-choo, fr.',
    ],
    rules: ['Okay, quick breakdown. The rules are easy, scroll 👇'],
    teaser: ['Yo! I’m {me}, your local guide. Want the rules in a minute? Zero boring, promise.'],
    install: [
      'Drop me on your home screen and I’m always one tap away. You won’t sleep through midnight, fr.',
    ],
    write: [
      'Write like you’d text a friend. Being a bit cringe is fine — being real is what counts.',
      'A few honest lines and someone across the planet gets the best vibe of the year.',
    ],
    gift: ['OMG, you got a gift! Open it, don’t keep me waiting 🎁'],
    midnight: ['Your gift lands at 00:00 your time. Set an alarm, or just trust me.'],
  },
  fairy: {
    greet: [
      'Welcome, {name}! Come, sit by the tree — the tale begins.',
      'Ah, {name} has come to my cottage! The snowstorm sings, the tree awaits.',
      'Once upon a time there were kind words, waiting for someone to write them… Hello, {name}!',
    ],
    tip: [
      'Every kind word becomes a crystal bauble. On New Year’s night it shines brighter than the stars.',
      'Call your friends and companions: for each one a light on the garland is lit.',
      'Mandarins can’t be bought with gold — only won with good deeds. Such is the pact.',
      'Knock on the cabin — you may try on the lights upon its roof.',
      'Open your gift, and the star on the treetop shall blaze.',
      'The merrier the feast, the more wondrous the yard: a little train arrives, and northern lights dance.',
    ],
    rules: ['Listen now, for this is how things are done in our tale…'],
    teaser: ['Greetings, traveller! I am {me}. Shall I tell you how our tale works?'],
    install: [
      'Set my cottage on your home screen — the road to me grows shorter, and you won’t sleep through midnight.',
    ],
    write: [
      'Write it like a letter to a fairy tale: from the heart, with warmth — the words will come.',
      'Send a kind word beyond the seven seas, and by some magic it returns.',
    ],
    gift: ['Hark! A gift at your door! Untie the ribbon, quick…'],
    midnight: ['When the clocks strike midnight in your lands, the gift shall appear.'],
  },
  grumpy: {
    greet: [
      'Oh. {name}. You again. Well… come in. I’m glad. A little.',
      '{name}, finally. The tree won’t decorate itself, you know.',
      'Oof, my back… Hello, {name}. Write at least one greeting, will you?',
    ],
    tip: [
      'Every greeting is a bauble on the tree. I hang them myself, by the way. By hand.',
      'Invite friends. A garland light for each. I’ll be changing bulbs, but fine.',
      'Mandarins aren’t for sale. I checked. Not for sale. Good deeds only.',
      'Tap the cabin to try on the lights. Just don’t touch my favourite one.',
      'The star lights up when you open your gift. Not before. Don’t ask.',
      'Raise the festive level and I’ll start the little train. It’s noisy… but pretty.',
    ],
    rules: ['Rules. Yes, rules. Read carefully, I won’t repeat myself. Well… maybe once.'],
    teaser: ['I’m {me}. Everyone asks how this works. Fine, I’ll explain. One minute, tops.'],
    install: ['Put me on your home screen, I suppose. Saves you looking for me every time.'],
    write: [
      'Write something kind. Grumbling is my job.',
      'And no copy-paste “health and happiness”, alright? Come up with your own.',
    ],
    gift: ['Well, what are you waiting for? A gift came. Open it, I didn’t carry it for nothing.'],
    midnight: ['The gift comes at midnight your time. Not a minute earlier. I’m punctual.'],
  },
};

export const LINES = { ru, en };
