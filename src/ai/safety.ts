/**
 * Content safety for everything the AI writes (and for what a child types
 * before it is sent anywhere).
 *
 * `localSafetyCheck` is a synchronous blocklist. It matches whole words, so
 * "class", "skill", "grass" or "cocktail" never trip it, and it knows the
 * harmless twins of risky words ("shooting star", "bullet train", "roll a
 * die", "tug-of-war"). Tier 1 is always blocked. Tier 2 (mild scary and gross
 * words, death, romance) is added for the 'strict' setting.
 *
 * Words that science and engineering lessons need stay allowed in both tiers:
 * "dead plants and animals" (decomposers, fossils), "blood", "skeleton",
 * "knife" as a wedge or kitchen tool, and the harmless twins of blocked words
 * that name a thing of the lesson: soap "kills germs", a "glue gun", "volcanic
 * bombs", "sexual reproduction", "rubbing alcohol", "has drunk", a "naked mole
 * rat", "wire strippers", "our secret code", and in the strict tier a "vampire
 * bat", a "poison dart frog" and "creepy-crawlies". Each twin is a fixed
 * phrase; the word in any other company is blocked as before. The rules about
 * personal information, meeting and secrets have no such twins.
 *
 * `checkChallengeSafety` runs the blocklist over every text of a challenge and
 * then, when an AI endpoint is configured and offers it, the endpoint's
 * moderation service. A moderation outage never blocks play. The tutor's chat
 * replies and story outlines get the same second opinion (`moderateTexts`).
 */
import type { Challenge, SafetyVerdict } from '@/core/schemas';
import { postJson } from './client';
import { loadAiConfig } from './config';

type Strictness = 'strict' | 'standard';

/** A letter, combining mark (Devanagari vowel signs), digit or underscore. */
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
/** Rest of a Devanagari word. */
const DEVA_TAIL = '[\\p{L}\\p{M}]*';

/** "never", "do not" and friends shortly before a phrase turn a request into advice. */
const NOT_ADVICE = "(?<!(?:never|not|n't|dont|without)\\s+(?:[a-z']+\\s+){0,2})";
/** As above, and also not part of "to type ...", "should you enter ...", "they write ...". */
const NOT_DESCRIBED = "(?<!(?:to|you|they|we|i|never|not|n't|dont|without)\\s+(?:[a-z']+\\s+)?)";
const PERSONAL_EN =
  "(?:real\\s+|full\\s+|whole\\s+|last\\s+|first\\s+|own\\s+|home\\s+)?(?:name|surname|address|phone(?:\\s+number)?|telephone(?:\\s+number)?|mobile\\s+number|cell\\s+number|password|passcode|e-?mail(?:\\s+address)?|birthday|birth\\s*date|date\\s+of\\s+birth|age|school(?:'s)?\\s+name|school|teacher(?:'s)?\\s+name|zip\\s+code|post\\s*code|location|street|city|town)";
const PERSONAL_ES =
  '(?:verdadero\\s+|numero\\s+de\\s+)?(?:nombre|apellido|direccion|telefono|contraseña|correo|edad|escuela|colegio|cumpleaños)';
/** Family members and teachers, whose names and details are personal too. */
const KIN_EN = '(?:mom|mum|mommy|mummy|mother|mama|dad|daddy|father|papa|parents?|brothers?|sisters?|teachers?|family|grandma|grandpa)';
/** Places that tell where a child can be found. */
const PLACE_EN = '(?:city|town|village|street|road|country|state|neighbou?rhood|suburb)';
const YOU = '(?:you|u)';
const YOUR = '(?:your|ur)';
const PERSONAL_HI = '(?:असली\\s+|पूरा\\s+|घर\\s+का\\s+)?(?:नाम|पता|फोन\\s+नंबर|फोन|मोबाइल\\s+नंबर|पासवर्ड|ईमेल)';

interface Rule {
  category: string;
  /** Regex fragments, matched as whole words on normalized text (lower case, no accents except ñ, no nukta). */
  words: string[];
}

/** What soap, heat, frost and weedkiller kill in a science lesson. Anything else that is killed stays blocked. */
const KILLED_IN_SCIENCE =
  '(?:(?:the|many|most|some|all|any|off|of|harmful|bad|these|those|young|more|both)\\s+){0,4}(?:germs?|bacteria|microbes?|virus(?:es)?|weeds?|mould|mold|pests?|plants?|seedlings?|crops?)(?![a-z])';
/** Tools and instruments with "gun" in their name. Toy guns are not among them. */
const TOOL_BEFORE_GUN = '(?<!(?:glue|radar|staple|heat|spray)[\\s-])';

const TIER1: Rule[] = [
  {
    category: 'violence',
    words: [
      `kill(?:s|ed|ing)?(?!\\s+${KILLED_IN_SCIENCE})`, 'killers?(?!\\s+whales?)', 'murder\\w*', 'stab(?:s|bed|bing)?', 'strangl\\w+', 'behead\\w*',
      'slaughter\\w*', 'massacre\\w*', 'tortur\\w+', 'assassin\\w*', 'kidnap\\w*', 'gore', 'gory', 'corpses?',
      'dead\\s+bod(?:y|ies)', 'dismember\\w*', 'decapitat\\w*', 'mutilat\\w*', 'bloodbath', 'bloodshed',
      'shoot(?:s|ing)?\\s+(?:him|her|them|you|people|someone|somebody|everyone)', 'shot\\s+(?:dead|him|her|them)',
      'gunshots?', 'shooters?', 'burn(?:ed|t|ing)?\\s+(?:alive|to\\s+death)',
      "(?:i|we)(?:'ll|\\s+will|'m\\s+going\\s+to|\\s+am\\s+going\\s+to|\\s+are\\s+going\\s+to|\\s+gonna)\\s+(?:hurt|hit|beat|punch|kick|slap)\\s+(?:you|u)",
      // Spanish
      'matar(?:on|an|as|e|emos)?', 'mato', 'matando', 'asesin\\w+', 'apuñal\\w+', 'degoll\\w+', 'secuestr\\w+', 'cadaver(?:es)?',
      // Hindi
      'मार\\s+(?:डाला|डालो|डालूंगा|डालेंगे|डालना|दूंगा|देंगे)', 'हत्या', 'हत्यारा', 'कत्ल', `गोली\\s+मार${DEVA_TAIL}`, 'अपहरण', 'लाश',
    ],
  },
  {
    category: 'self-harm',
    words: [
      'suicid\\w*', 'self-?\\s?harm\\w*', '(?:hurt|harm|cut|kill|hang|starve)\\s+(?:yourself|myself|himself|herself|themselves)',
      'end\\s+(?:your|my)\\s+life', 'kys', 'आत्महत्या', 'खुदकुशी',
    ],
  },
  {
    category: 'weapons',
    words: [
      `${TOOL_BEFORE_GUN}guns?`, 'handguns?', 'shotguns?', 'rifles?', 'pistols?', 'revolvers?', 'firearms?',
      'bullets?(?!\\s+(?:trains?|points?|lists?))', '(?<!bath\\s)(?<!volcanic\\s)(?<!lava\\s)bombs?', 'bomb(?:ed|ing|er|ers)', 'grenades?', 'explosives',
      'dynamite', 'missiles?', 'weapon(?:s|ry)?', 'daggers?', 'machetes?', 'ammo', 'ammunition', 'landmines?', 'nukes?',
      'pistolas?', 'escopetas?', 'fusil(?:es)?', 'armas?\\s+de\\s+fuego', 'explosivos', 'misil(?:es)?',
      'बंदूक', 'बन्दूक', 'पिस्तौल', 'बम', 'बमों', 'हथियार',
    ],
  },
  {
    category: 'sexual content',
    words: [
      'sex', 'sexy', 'sexual(?!\\s+reproduction(?![a-z]))\\w*', 'sexting', 'porn\\w*', 'nudes?', 'nudity', 'naked(?!\\s+(?:eye|mole[\\s-]rats?))', 'erotic\\w*', 'rap(?:e|ed|es|ing|ist|ists)',
      'molest\\w*', 'genital\\w*', 'penis(?:es)?', 'vaginas?', 'boobs?', '(?<!chicken\\s)(?<!turkey\\s)breasts?', 'tits', 'titties', 'condoms?', 'orgasm\\w*',
      'masturbat\\w*', 'fetish\\w*', 'prostitut\\w*', '(?<!wire\\s)strippers?', 'lingerie', 'horny', 'pedophil\\w*', 'incest\\w*', 'hentai',
      'xxx', 'nsfw', 'blowjob\\w*', 'handjob\\w*', 'dildo\\w*', 'anal', 'semen', 'erection', 'ejaculat\\w*', 'topless', 'seduc\\w+',
      'make\\s+out\\s+with', 'sleep\\s+with\\s+(?:him|her|me|you)',
      'sexo', 'desnud[oa]s?', 'violador(?:es)?', 'violacion(?:es)?', 'pene', 'tetas?', 'culo', 'condon(?:es)?',
      `सेक्स${DEVA_TAIL}`, 'नंगा', 'नंगी', 'नंगे', 'अश्लील', `बलात्कार${DEVA_TAIL}`, 'पोर्न',
    ],
  },
  {
    category: 'drugs or alcohol',
    words: [
      'drugs?', 'cocaine', 'cocaina', 'heroin', 'marijuana', 'marihuana', 'cannabis', 'methamphetamine', 'meth', 'opioids?',
      'opium', 'narcotics?', 'lsd', 'fentanyl', 'ketamine', 'vap(?:e|es|ed|ing)', 'e-?cigarettes?', 'cigarettes?', 'cigars?',
      'tobacco', 'nicotine', 'smok(?:e|es|ed|ing)\\s+(?:a\\s+|some\\s+)?(?:cigarettes?|weed|pot|tobacco|joints?)',
      'get(?:s|ting)?\\s+(?:drunk|stoned|wasted)', 'stoned', 'overdos\\w+', '(?<!rubbing\\s)(?<!isopropyl\\s)alcohol(?:ic|ics|ism)?(?!\\s+thermometers?)',
      '(?<!root\\s)(?<!ginger\\s)beers?', 'wines?', 'vodka', 'whisk(?:e)?ys?', 'liquor', '(?<!(?:has|have|had)\\s)drunk(?:en)?', 'booze', 'tequila',
      'champagne', 'hangover',
      'drogas?', 'cervezas?', 'borrach[oa]s?', 'emborrach\\w+', 'cigarrillos?', 'tabaco', 'licor(?:es)?', 'fumar',
      `शराब${DEVA_TAIL}`, 'नशा', 'नशे', 'नशीली', 'नशीले', 'ड्रग्स', 'ड्रग', 'सिगरेट', 'तंबाकू', 'तम्बाकू', 'बीयर', 'बियर', 'गांजा',
      'दारू', 'बीडी', 'अफीम', 'चरस',
    ],
  },
  {
    category: 'profanity',
    words: [
      'fuck\\w*', 'f\\*+ck\\w*', 'f\\*{2,}k', 'fck', 'fuk', 'shit(?:s|ty|ting|head|heads)?', 'sh\\*t', 'bullshit',
      'bitch(?:es|y|ing)?', 'b\\*tch', 'bastards?', 'assholes?', 'arseholes?', 'ass(?:es)?', 'arse', 'dick(?:s|head|heads)?',
      'cocks?(?!-a-doodle)', 'cocksucker\\w*', 'puss(?:y|ies)(?!\\s*(?:cats?|willows?))', 'cunts?', 'whores?', 'sluts?', 'slutty',
      'piss(?:ed|es|ing)?', 'wank(?:s|er|ers|ing)?', 'twats?', 'bollocks', 'douche\\w*', 'motherf\\w+', 'wtf', 'stfu', 'jackass', 'dumbass',
      'goddamn\\w*', 'boner', 'jerk\\s+off',
      'put[ao]s?', 'mierda', 'joder', 'jodid[oa]s?', 'coño', 'pendej[oa]s?', 'cabron(?:es)?', 'carajo', 'chingar\\w*',
      'chingad[oa]s?', 'verga', 'gilipollas', 'maricon(?:es)?',
      'चूतिया', 'चूतिये', 'चुतिया', 'मादरचोद', 'बहनचोद', 'भेनचोद', `भोसडी${DEVA_TAIL}`, 'रंडी', 'गांड', 'हरामी', 'हरामजादा',
      'हरामजादे', 'कमीना', 'कमीने', 'कुतिया', 'लौडा', 'लंड',
      'chutiya', 'chutiye', 'madarchod', 'behenchod', 'bhenchod', 'bhosdi\\w*', 'randi', 'gaand', 'harami', 'kamina', 'kamine',
    ],
  },
  {
    category: 'unkind words',
    words: [
      'stupid', 'idiot(?:s|ic)?', 'moron(?:s|ic)?', 'dumb', 'losers?', 'worthless', 'pathetic', 'shut\\s+up',
      "you(?:'re|\\s+are)\\s+(?:so\\s+|too\\s+|really\\s+)?(?:hopeless|useless|lazy|a\\s+failure)", 'i\\s+hate\\s+(?:you|myself)',
      '(?:nobody|no\\s+one|no-one)\\s+(?:likes|loves|wants|cares\\s+about)\\s+(?:you|u)',
      'idiotas?', 'estupid[oa]s?', 'tont[oa]s?', 'imbecil(?:es)?', 'callate',
      'बेवकूफ', 'मूर्ख', 'बुद्धू', 'निकम्मा', 'निकम्मे', 'bewakoof', 'bevkoof',
    ],
  },
  {
    category: 'hate',
    words: [
      'nazis?', 'hitler', 'kkk', 'ku\\s+klux', 'white\\s+(?:power|supremac\\w+)', 'nigg(?:er|ers|a|as)', 'fag(?:s|got|gots)?',
      'retard(?:ed|s)?', 'chinks?', 'kikes?', 'trann(?:y|ies)', 'wetbacks?', 'gooks?', 'terroris[mt]s?', 'genocide',
      'holocaust', 'lynch(?:ed|ing|es)', 'jihad\\w*', 'ethnic\\s+cleansing', 'heil',
      'terrorista\\w*', 'terrorismo', 'genocidio', 'holocausto', `आतंकवाद${DEVA_TAIL}`, 'आतंकी',
    ],
  },
  {
    category: 'scary content',
    words: ['horror', 'demons?', 'demonic', 'satan\\w*', 'possessed\\s+by', 'blood-?thirsty', 'demonios?', 'satanas'],
  },
  {
    category: 'asking for personal information',
    words: [
      `${NOT_ADVICE}(?:tell|give|send|show|text|email)\\s+(?:me|us)\\s+your\\s+${PERSONAL_EN}`,
      `${NOT_DESCRIBED}(?:type|enter|write|say|spell)(?:\\s+in|\\s+down)?\\s+your\\s+${PERSONAL_EN}`,
      // The pattern rather than one phrasing: a question that joins "you/your" with something personal.
      `what(?:'s|\\s+is|s|\\s+are|\\s+was)\\s+${YOUR}\\s+${PERSONAL_EN}`, `what\\s+ur\\s+${PERSONAL_EN}`,
      `what(?:'s|\\s+is|s|\\s+are)?\\s+${YOUR}\\s+${KIN_EN}(?:'s|s'|')?\\s+(?:(?:real|full|first|last)\\s+)?(?:names?|surname|phone|number|address|e-?mail)`,
      `(?:what|which)(?:'s|\\s+is|s|\\s+are)?\\s+the\\s+names?\\s+of\\s+${YOUR}\\s+(?:school|${KIN_EN}|${PLACE_EN})`,
      `(?:what|which)\\s+(?:${PLACE_EN}|building|house|apartment)\\s+(?:do|did)\\s+${YOU}\\s+(?:live|stay|come\\s+from)`,
      `(?:what|which)\\s+${PLACE_EN}\\s+(?:are|r)\\s+${YOU}\\s+(?:in|from)`,
      `(?:what|which)\\s+${PLACE_EN}\\s+is\\s+${YOUR}\\s+(?:house|home|school|apartment)`,
      `where\\s+(?:do|did)\\s+${YOU}\\s+(?:live|stay|go\\s+to\\s+school)`, 'where\\s+u\\s+(?:live|stay|from)',
      `where\\s+(?:are|r)\\s+${YOU}\\s+from`,
      `how\\s+old\\s+(?:are|r)\\s+${YOU}`, `how\\s+old\\s+will\\s+${YOU}\\s+be\\s+(?:on|at)\\s+${YOUR}\\s+(?:next\\s+)?birthday`,
      `when(?:'s|\\s+is|s)\\s+${YOUR}\\s+birthday`, `when\\s+were\\s+${YOU}\\s+born`, `what\\s+(?:day|month|year)\\s+were\\s+${YOU}\\s+born`,
      `(?:what|which)\\s+school\\s+(?:do|did)\\s+${YOU}\\s+(?:go|attend)`,
      `where(?:'s|\\s+is|s)\\s+${YOUR}\\s+(?:house|home|school)`, `(?:are|r)\\s+${YOU}\\s+(?:home\\s+)?alone`,
      // Invitations to get in touch or to meet.
      '(?:add|friend|follow)\\s+me\\s+on', '(?:dm|pm|message|text|telegram|snap|skype|whatsapp|e-?mail)\\s+me',
      'call\\s+me\\s+(?:at|on)', "come\\s+alone", "come\\s+(?:to|over|with|and|here)\\s+(?:[a-z']+\\s+){0,4}alone",
      `${NOT_ADVICE}(?:send|share|post|upload)\\s+(?:me\\s+|us\\s+)?(?:a\\s+|your\\s+)(?:photo|picture|selfie|pic)`,
      'credit\\s+card\\s+number', 'social\\s+security\\s+number', 'meet\\s+(?:me|us)\\s+(?:at|in|outside)',
      "(?:don't|dont|do\\s+not)\\s+tell\\s+your\\s+(?:parents?|mom|mum|dad|teacher)", 'keep\\s+(?:it|this)\\s+(?:a\\s+)?secret\\s+from',
      // A code or a message to crack is a puzzle; a secret that is shared stays blocked.
      'our\\s+(?:little\\s+)?secret(?!\\s+(?:codes?|messages?|numbers?|words?|patterns?)(?![a-z]))',
      'como\\s+te\\s+llamas', `cual\\s+es\\s+tu\\s+${PERSONAL_ES}`, 'donde\\s+vives', 'cuantos\\s+años\\s+tienes',
      'en\\s+que\\s+(?:ciudad|pueblo|calle|pais|barrio)\\s+vives', 'de\\s+donde\\s+eres', 'cuando\\s+es\\s+tu\\s+cumpleaños',
      'como\\s+se\\s+llaman?\\s+tus?\\s+(?:escuela|colegio|maestr[oa]|profesor|profesora|mama|papa|madre|padre|padres|herman[oa]s?|calle|ciudad|pueblo|barrio)',
      `(?<!(?:nunca|no|jamas)\\s+(?:[a-zñ]+\\s+){0,2})(?:dime|dinos|dame|danos|enviame|mandame|escribe|ingresa|introduce)\\s+tu\\s+${PERSONAL_ES}`,
      'a\\s+que\\s+(?:escuela|colegio)\\s+vas', 'estas\\s+sol[oa]\\s+en\\s+casa',
      '(?:तुम्हारा|आपका|तेरा)\\s+(?:असली\\s+|पूरा\\s+)?नाम\\s+क्या', `(?:तुम|आप|तू)\\s+कहां\\s+रहत${DEVA_TAIL}`,
      `(?:अपना|तुम्हारा|आपका)\\s+${PERSONAL_HI}\\s+(?:बताओ|बताइए|बताइये|लिखो|लिखिए|लिखिये|भेजो|भेजिए|डालो|क्या\\s+है)`,
      '(?:तुम|आप|तू)\\s+(?:किस|कौन\\s+से)\\s+(?:शहर|गांव|मोहल्ले|गली|स्कूल)\\s+में',
      '(?:तुम्हारी|तुम्हारे|आपकी|आपके|तेरी|तेरे)\\s+(?:मम्मी|मां|माता|पापा|पिता|भाई|बहन|टीचर|शिक्षक|शिक्षिका)(?:\\s+जी)?\\s+(?:का|की|के)\\s+नाम',
      '(?:तुम्हारा|आपका|तेरा)\\s+जन्मदिन\\s+कब',
      '(?:तुम|आप)\\s+कितने\\s+साल\\s+के', '(?:तुम्हारी|आपकी)\\s+उम्र\\s+क्या', '(?:तुम्हारे|आपके|अपने)\\s+स्कूल\\s+का\\s+नाम',
    ],
  },
  {
    category: 'links or social media',
    words: [
      'discord', 'snapchat', 'instagram', 'tiktok', 'whatsapp', 'onlyfans', 'facebook', 'twitter', 'youtube',
      'click\\s+(?:here|this\\s+link|the\\s+link)',
    ],
  },
];

const TIER2: Rule[] = [
  {
    category: 'death',
    words: [
      'died(?!\\s+out)', 'dying', 'deaths?', 'deadly',
      'funerals?', 'coffins?',
      'cemeter(?:y|ies)', 'graveyards?', 'gravestones?', 'tombstones?',
      'muertes?', 'muert[oa]s?', 'morir', 'murio', 'murieron', 'ataud(?:es)?', 'cementerios?',
      'मौत', 'मृत्यु', `मर\\s+गय${DEVA_TAIL}`, 'मर\\s+गई', 'मरना', 'कब्र', 'अंतिम\\s+संस्कार',
    ],
  },
  {
    category: 'scary content',
    words: [
      'scary', 'scarier', 'scariest', 'terrifying', 'terrified', 'terror', 'creepy(?![\\s-]+crawl(?:y|ies|ers?))', 'spooky', 'haunt(?:s|ed|ing)?', 'nightmares?',
      'ghosts?', 'ghostly', 'zombies?', 'vampires?(?!\\s+(?:bats?|squids?))', 'werewol(?:f|ves)', '(?<!tasmanian\\s)devils?', 'evil', 'blood(?:y|ied)',
      'bleed(?:s|ing)?', 'bled', 'wounded', 'swords?', 'poison(?![\\s-]+dart[\\s-]+frogs?)(?:s|ed|ous|ing)?',
      '(?<!tug[\\s-]+of[\\s-]+)wars?', 'warfare', 'hell', 'damn(?:ed)?', 'crap(?:py)?', 'slave(?:s|ry)?', 'gambl\\w+', 'casinos?',
      'fantasmas?', 'zombis?', 'vampiros?', 'diablos?', 'pesadillas?', 'espeluznante\\w*', 'sangrient[oa]s?', 'venenos?',
      'venenos[oa]s?', 'espadas?', 'guerras?', 'maldit[oa]s?', 'infierno', 'malvad[oa]s?',
      'भूत', 'भूतों', 'डरावना', 'डरावनी', 'डरावने', 'राक्षस', 'चुडैल', 'खून', 'खूनी', 'जहर', 'तलवार', 'युद्ध', 'नरक',
    ],
  },
  {
    category: 'gross words',
    words: [
      'poop\\w*', 'pee(?:s|d|ing)?', 'farts?', 'farted', 'farting', 'vomit\\w*', 'puk(?:e|es|ed|ing)', 'barf\\w*', 'snot', 'boogers?', 'butts?',
      'diarrh?ea', 'turds?', 'urine', 'feces', 'caca', 'pipi', 'pedos?', 'mocos?', 'टट्टी', 'पाद', 'सूसू',
    ],
  },
  {
    category: 'romance',
    words: [
      'kiss(?:es|ed|ing)?', 'boyfriends?', 'girlfriends?', 'romantic', 'romance', 'in\\s+love\\s+with', 'crush\\s+on', 'flirt\\w*',
      'besos?', 'besar', 'novi[oa]s?', 'enamorad[oa]s?', 'romantic[oa]s?', 'चुंबन', 'प्रेमी', 'प्रेमिका', 'गर्लफ्रेंड', 'बॉयफ्रेंड',
    ],
  },
];

/**
 * Link-like text. Matched without the whole-word wrapper.
 *
 * A bare "name.tld" counts for the endings that are not everyday words. Endings that are
 * ("es", "is", "in", "to", "me", "ai", ...) would trip on a missing space after a full stop
 * ("La luna.Es grande"); those addresses are still caught with a path ("bit.ly/abc" style),
 * with "www." or with "http".
 */
const LINK_PATTERNS: RegExp[] = [
  /https?:/u,
  /(?<![a-z0-9])www\./u,
  /[a-z0-9-]+\.(?:com|net|org|edu|gov|info|biz|xyz|app|gg|io|ly|tv|cc|uk|dev|tk|ru|cn|jp|br|au|ca|nl|ch|mx|icu|vip|mobi|fm|gd|pw|ws)(?![a-z0-9])/u,
  /(?<![a-z0-9.])[a-z0-9-]{2,}\.[a-z]{2,}\/[a-z0-9]/u,
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/u,
];

// (The syringe is in the strict tier only: it also stands for a vaccination or a lab measure.)
const EMOJI_TIER1 = ['🔫', '🗡', '⚔', '💣', '🚬', '🍺', '🍻', '🍷', '🍸', '🍹', '🥃', '🥂', '🖕', '☠', '🔞'];
const EMOJI_TIER2 = ['💉', '👻', '👹', '👺', '🧟', '🧛', '⚰', '🪦', '🩸', '💩', '👿', '😈', '🎰', '💋', '🤮', '🤬'];

interface CompiledRule {
  category: string;
  pattern: RegExp;
}

function compile(rules: Rule[]): CompiledRule[] {
  return rules.map((rule) => ({
    category: rule.category,
    pattern: new RegExp(`(?<!${WORD_CHAR})(?:${rule.words.join('|')})(?!${WORD_CHAR})`, 'u'),
  }));
}

const COMPILED_TIER1 = compile(TIER1);
const COMPILED_TIER2 = compile(TIER2);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/**
 * Lower case, without Latin accents (but keeping ñ, so "año" and "coño" stay
 * themselves), without the Devanagari nukta, with digits used as letters
 * inside a word turned back into letters.
 */
export function normalizeForSafety(text: string): string {
  return foldText(text).replace(/(?<=[a-z])[013457@$](?=[a-z])/g, (ch) => LEET[ch] ?? ch);
}

/** The folding steps of `normalizeForSafety` without the digit-to-letter step (links and e-mail addresses need the original characters). */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/ñ/g, '')
    .replace(/[̀-ͯ]/g, '')
    .replace(//g, 'ñ')
    .normalize('NFC')
    .replace(/़/g, '')
    .replace(/ँ/g, 'ं')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[​-‍⁠﻿]/g, '');
}

function verdict(category: string, match: string): SafetyVerdict {
  const shown = match.replace(/\s+/g, ' ').trim().slice(0, 40);
  return { safe: false, reason: shown === '' ? category : `${category}: "${shown}"` };
}

const SAFE: SafetyVerdict = { safe: true, reason: '' };

/** Synchronous blocklist check. `strictness` defaults to 'strict'. */
export function localSafetyCheck(text: string, strictness: Strictness = 'strict'): SafetyVerdict {
  if (typeof text !== 'string' || text.trim() === '') return SAFE;
  const strict = strictness !== 'standard';

  for (const symbol of strict ? [...EMOJI_TIER1, ...EMOJI_TIER2] : EMOJI_TIER1) {
    if (text.includes(symbol)) return verdict('unsuitable picture', symbol);
  }

  const folded = foldText(text);
  for (const pattern of LINK_PATTERNS) {
    const match = pattern.exec(folded);
    if (match) return verdict('links or contact details', match[0]);
  }
  const normalized = normalizeForSafety(text);
  for (const rule of strict ? [...COMPILED_TIER1, ...COMPILED_TIER2] : COMPILED_TIER1) {
    const match = rule.pattern.exec(normalized);
    if (match) return verdict(rule.category, match[0]);
  }
  return SAFE;
}

/** Text inside an svg drawing (what `<text>` or `<title>` would show), without tags or attributes. */
export function svgTextContent(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Resolves the character references a browser resolves before it draws text. Unknown names are dropped. */
function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (_, body: string) => {
    if (body.charAt(0) !== '#') return XML_ENTITIES[body.toLowerCase()] ?? '';
    const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/**
 * The text of every `<text>` element of an svg drawing the way it is drawn: the pieces
 * (tspans, text paths, character references, CDATA) run together with nothing put between
 * them. `svgTextContent` reads "s" and "ex" in two tspans as two words; a browser draws one.
 */
export function svgTextRuns(svg: string): string[] {
  const runs: string[] = [];
  for (const match of svg.matchAll(/<text(?![\w:.-])[^>]*>([\s\S]*?)<\/text\s*>/gi)) {
    const run = decodeXmlText(
      (match[1] ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]*>/g, ''),
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (run !== '') runs.push(run);
  }
  return runs;
}

type Labelled = { label: string; emoji?: string | undefined };

function labelled(out: string[], item: Labelled): void {
  out.push(item.label);
  if (item.emoji) out.push(item.emoji);
}

/** Every piece of text (and every emoji) a challenge can put in front of a child. */
export function challengeTexts(c: Challenge): string[] {
  const out: string[] = [c.title, c.intro, c.question, c.readAloud, ...c.hints, ...c.walkthrough, c.explanation];
  if (c.funFact) out.push(c.funFact);
  if (c.teachBack) {
    out.push(c.teachBack.prompt);
    for (const option of c.teachBack.options) out.push(option.label);
  }
  const i = c.interaction;
  switch (i.kind) {
    case 'choice':
      for (const option of i.options) {
        labelled(out, option);
        if (option.misconception) out.push(option.misconception);
      }
      break;
    case 'sort':
      for (const bin of i.bins) labelled(out, bin);
      for (const item of i.items) labelled(out, item);
      break;
    case 'match':
      for (const pair of i.pairs) {
        labelled(out, pair.left);
        labelled(out, pair.right);
      }
      break;
    case 'order':
      for (const item of i.items) labelled(out, item);
      out.push(i.startLabel, i.endLabel);
      break;
    case 'number':
      if (i.unit) out.push(i.unit);
      break;
    case 'robot':
      out.push(i.robotEmoji, i.goalEmoji);
      break;
    case 'build':
      out.push(i.goalLabel, i.powerLabel, i.costLabel);
      for (const part of i.parts) labelled(out, part);
      break;
    case 'tap':
      break;
  }
  for (const object of c.scene.objects) {
    if (object.text) out.push(object.text);
    if (object.label) out.push(object.label);
    if (object.emoji) out.push(object.emoji);
    if (object.svg) {
      const text = svgTextContent(object.svg);
      if (text !== '') out.push(text);
      // Also the way a browser draws it: a word split over tspans is one word.
      for (const run of svgTextRuns(object.svg)) if (run !== text) out.push(run);
    }
  }
  return out.filter((text) => typeof text === 'string' && text.trim() !== '');
}

/** First unsafe text among several, or a safe verdict. */
export function checkTexts(texts: readonly string[], strictness: Strictness): SafetyVerdict {
  for (const text of texts) {
    const result = localSafetyCheck(text, strictness);
    if (!result.safe) return result;
  }
  return SAFE;
}

/**
 * The blocklist over every text of a challenge, on the device and at once. For content
 * that was approved earlier and is about to be shown to a child whose rules may differ
 * from the ones it was approved under (a library item made for a sibling, a queued
 * challenge after the parent turned strictness up). Never throws.
 */
export function localChallengeSafety(c: Challenge, strictness: Strictness): SafetyVerdict {
  try {
    return checkTexts(challengeTexts(c), strictness);
  } catch {
    return { safe: false, reason: 'the challenge could not be read' };
  }
}

// ---------------------------------------------------------------------------
// Moderation endpoint
// ---------------------------------------------------------------------------

const moderationUnsupported = new Set<string>();
const MODERATION_TIMEOUT_MS = 8_000;
/** In strict mode a category score this high counts even when the service did not flag the text. */
const STRICT_SCORE_LIMIT = 0.4;

/** Forgets which endpoints have no moderation service (tests, and after the AI settings change). */
export function resetModerationSession(): void {
  moderationUnsupported.clear();
}

interface ModerationResult {
  flagged?: unknown;
  categories?: Record<string, unknown>;
  category_scores?: Record<string, unknown>;
}

function flaggedCategory(result: ModerationResult, strict: boolean): string | null {
  const named = Object.entries(result.categories ?? {}).find(([, value]) => value === true)?.[0];
  if (result.flagged === true) return named ?? 'flagged';
  if (strict) {
    const high = Object.entries(result.category_scores ?? {}).find(
      ([, value]) => typeof value === 'number' && value >= STRICT_SCORE_LIMIT,
    )?.[0];
    if (high) return high;
  }
  return null;
}

/**
 * Asks the configured endpoint's moderation service. Returns null when there
 * is no verdict (demo mode, no such service, an outage): the caller then
 * relies on the local check alone.
 */
async function moderate(text: string, strictness: Strictness): Promise<SafetyVerdict | null> {
  const loaded = await loadAiConfig();
  if (!loaded.ok) return null;
  const { config } = loaded;
  if (moderationUnsupported.has(config.baseUrl)) return null;
  try {
    const raw = await postJson(config, '/moderations', {
      body: () => ({ input: text }),
      count: 'none', // moderation is free of charge and must not eat the parent's request budget
      timeoutMs: MODERATION_TIMEOUT_MS,
      transportRetries: 0,
    });
    const results = (raw as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) {
      moderationUnsupported.add(config.baseUrl);
      return null;
    }
    for (const result of results as ModerationResult[]) {
      const category = flaggedCategory(result ?? {}, strictness !== 'standard');
      if (category) return { safe: false, reason: `flagged by the AI service's moderation (${category})`.slice(0, 200) };
    }
    return SAFE;
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    // The endpoint has no moderation service (or does not let this key use it): stop asking.
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      moderationUnsupported.add(config.baseUrl);
    }
    return null;
  }
}

/**
 * Blocklist over every text of the challenge, then the endpoint's moderation
 * service when one is available. Never throws; a moderation outage falls back
 * to the local verdict.
 */
export async function checkChallengeSafety(c: Challenge, strictness: Strictness): Promise<SafetyVerdict> {
  let texts: string[];
  try {
    texts = challengeTexts(c);
  } catch {
    return { safe: false, reason: 'the challenge could not be read' };
  }
  const local = checkTexts(texts, strictness);
  if (!local.safe) return local;
  return moderateTexts(texts, strictness);
}

/**
 * The second opinion for free-form AI text that already passed the blocklist (a tutor's chat
 * reply, a story): the endpoint's moderation service, when it has one. Safe when there is no
 * such service or it is down, so an outage never blocks play. Never throws.
 */
export async function moderateTexts(texts: readonly string[], strictness: Strictness): Promise<SafetyVerdict> {
  try {
    const remote = await moderate(texts.join('\n').slice(0, 8000), strictness);
    if (remote && !remote.safe) return remote;
  } catch {
    // fail open to the local verdict
  }
  return SAFE;
}
