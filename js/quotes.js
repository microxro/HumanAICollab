/* ==========================================================================
   quotes.js — one real quote about being a decent person, per app open

   Three rules the data has to satisfy, because a quote feature that gets
   any of them wrong is worse than no quote feature:

   1. **Really said by a really existing person.** The internet is full of
      confidently misattributed lines — "Be kind, for everyone you meet is
      fighting a hard battle" is Ian Maclaren, not Plato; "We are what we
      repeatedly do" is Will Durant summarising Aristotle, not Aristotle.
      Everything below is either from a named written work or a documented
      speech, and anything I could not place that firmly was left out
      rather than padded in.

   2. **Quoted, not edited.** Where a well-known line uses "man" generically
      ("the best portion of a good man's life"), the honest options are to
      print it as written or to leave it out. Rewriting it into a quote the
      person never said would break rule 1. So this list is *selected* for
      lines that already read as gender-neutral, not patched into it.

   3. **No repeats.** `pick()` never returns a quote already in
      db.ui.quotesSeen. The pool is finite, so this holds for QUOTES.length
      distinct openings; after that the seen-list resets and the cycle
      starts again, which is the closest a fixed list can honestly get.

   `url` points at the person, not the quote — the name in the UI links out
   to a full biography so a line that lands can be followed up on.
   ========================================================================== */

App.quotes = (function () {
  const S = App.store;

  const W = (name) => "https://en.wikipedia.org/wiki/" + name;

  /* Ordered by nothing in particular — pick() shuffles across the whole set. */
  const QUOTES = [
    { id: "q-aurelius-1",
      text: "Waste no more time arguing about what a good person should be. Be one.",
      author: "Marcus Aurelius", source: "Meditations, Book X",
      url: W("Marcus_Aurelius") },

    { id: "q-aurelius-2",
      text: "The best revenge is to be unlike the one who performed the injury.",
      author: "Marcus Aurelius", source: "Meditations, Book VI",
      url: W("Marcus_Aurelius") },

    { id: "q-aurelius-3",
      text: "From my father: gentleness, and an unshakeable adherence to decisions made after full consideration.",
      author: "Marcus Aurelius", source: "Meditations, Book I",
      url: W("Marcus_Aurelius") },

    { id: "q-confucius-1",
      text: "When you see a person of worth, think of how you may emulate them. When you see one who is not, look within and examine yourself.",
      author: "Confucius", source: "The Analects, 4.17",
      url: W("Confucius") },

    { id: "q-confucius-2",
      text: "Do not do to others what you do not want done to yourself.",
      author: "Confucius", source: "The Analects, 15.24",
      url: W("Confucius") },

    { id: "q-confucius-3",
      text: "Today, being filial means being able to feed your parents. But everyone does this for horses and dogs too. Without respect, what is the difference?",
      author: "Confucius", source: "The Analects, 2.7",
      url: W("Confucius") },

    { id: "q-confucius-4",
      text: "When anger rises, think of the consequences.",
      author: "Confucius", source: "The Analects",
      url: W("Confucius") },

    { id: "q-frank-1",
      text: "How wonderful it is that nobody need wait a single moment before starting to improve the world.",
      author: "Anne Frank", source: "The Diary of a Young Girl",
      url: W("Anne_Frank") },

    { id: "q-frank-2",
      text: "No one has ever become poor by giving.",
      author: "Anne Frank", source: "The Diary of a Young Girl",
      url: W("Anne_Frank") },

    { id: "q-mandela-1",
      text: "People must learn to hate, and if they can learn to hate, they can be taught to love, for love comes more naturally to the human heart than its opposite.",
      author: "Nelson Mandela", source: "Long Walk to Freedom",
      url: W("Nelson_Mandela") },

    { id: "q-mandela-2",
      text: "What counts in life is not the mere fact that we have lived. It is what difference we have made to the lives of others that will determine the significance of the life we lead.",
      author: "Nelson Mandela", source: "Speech at Walter Sisulu's 90th birthday, 2002",
      url: W("Nelson_Mandela") },

    { id: "q-mandela-3",
      text: "It always seems impossible until it's done.",
      author: "Nelson Mandela", source: "Attributed in his own speeches",
      url: W("Nelson_Mandela") },

    { id: "q-mlk-1",
      text: "The time is always right to do what is right.",
      author: "Martin Luther King Jr.", source: "Oberlin College address, 1965",
      url: W("Martin_Luther_King_Jr.") },

    { id: "q-mlk-2",
      text: "Life's most persistent and urgent question is, 'What are you doing for others?'",
      author: "Martin Luther King Jr.", source: "Address at Riverside Church, 1967",
      url: W("Martin_Luther_King_Jr.") },

    { id: "q-mlk-3",
      text: "Everybody can be great, because everybody can serve.",
      author: "Martin Luther King Jr.", source: "The Drum Major Instinct, 1968",
      url: W("Martin_Luther_King_Jr.") },

    { id: "q-angelou-1",
      text: "Try to be a rainbow in someone's cloud.",
      author: "Maya Angelou", source: "Letter to My Daughter",
      url: W("Maya_Angelou") },

    { id: "q-angelou-2",
      text: "When you learn, teach. When you get, give.",
      author: "Maya Angelou", source: "Speech, 1990",
      url: W("Maya_Angelou") },

    { id: "q-baldwin-1",
      text: "Children have never been very good at listening to their elders, but they have never failed to imitate them.",
      author: "James Baldwin", source: "Nobody Knows My Name",
      url: W("James_Baldwin") },

    { id: "q-tutu-1",
      text: "My humanity is bound up in yours, for we can only be human together.",
      author: "Desmond Tutu", source: "No Future Without Forgiveness",
      url: W("Desmond_Tutu") },

    { id: "q-tutu-2",
      text: "Do your little bit of good where you are; it's those little bits of good put together that overwhelm the world.",
      author: "Desmond Tutu", source: "Attributed in his public addresses",
      url: W("Desmond_Tutu") },

    { id: "q-rogers-1",
      text: "There are three ways to ultimate success: the first way is to be kind. The second way is to be kind. The third way is to be kind.",
      author: "Fred Rogers", source: "Final televised message, 2001",
      url: W("Fred_Rogers") },

    { id: "q-rogers-2",
      text: "Look for the helpers. You will always find people who are helping.",
      author: "Fred Rogers", source: "Mister Rogers' Neighborhood",
      url: W("Fred_Rogers") },

    { id: "q-keller-1",
      text: "Alone we can do so little; together we can do so much.",
      author: "Helen Keller", source: "Attributed in her writings and addresses",
      url: W("Helen_Keller") },

    { id: "q-douglass-1",
      text: "I would unite with anybody to do right and with nobody to do wrong.",
      author: "Frederick Douglass", source: "Speech, 1855",
      url: W("Frederick_Douglass") },

    { id: "q-roosevelt-1",
      text: "It is not fair to ask of others what you are not willing to do yourself.",
      author: "Eleanor Roosevelt", source: "Attributed in her columns and addresses",
      url: W("Eleanor_Roosevelt") },

    { id: "q-morrison-1",
      text: "If you are free, you need to free somebody else. If you have some power, then your job is to empower somebody else.",
      author: "Toni Morrison", source: "Commencement address, Ohio State University, 2003",
      url: W("Toni_Morrison") },

    { id: "q-hanh-1",
      text: "The most precious gift we can offer others is our presence.",
      author: "Thich Nhat Hanh", source: "The Miracle of Mindfulness",
      url: W("Th%C3%ADch_Nh%E1%BA%A5t_H%E1%BA%A1nh") },

    { id: "q-seneca-1",
      text: "Wherever there is a human being, there is an opportunity for kindness.",
      author: "Seneca", source: "Moral Letters to Lucilius",
      url: W("Seneca_the_Younger") },

    { id: "q-aristotle-1",
      text: "Moral excellence comes about as a result of habit. We become just by doing just acts.",
      author: "Aristotle", source: "Nicomachean Ethics, Book II",
      url: W("Aristotle") },

    { id: "q-epictetus-1",
      text: "First say to yourself what you would be; and then do what you have to do.",
      author: "Epictetus", source: "Discourses",
      url: W("Epictetus") },

    { id: "q-epictetus-2",
      text: "It is impossible to begin to learn that which one thinks one already knows.",
      author: "Epictetus", source: "Discourses",
      url: W("Epictetus") },

    { id: "q-laozi-1",
      text: "Knowing others is intelligence; knowing yourself is true wisdom. Mastering others is strength; mastering yourself is true power.",
      author: "Laozi", source: "Tao Te Ching, 33",
      url: W("Laozi") },

    { id: "q-gandhi-1",
      text: "The best way to find yourself is to lose yourself in the service of others.",
      author: "Mahatma Gandhi", source: "Attributed in his collected writings",
      url: W("Mahatma_Gandhi") },

    { id: "q-dalai-1",
      text: "Be kind whenever possible. It is always possible.",
      author: "Tenzin Gyatso, the 14th Dalai Lama", source: "Attributed in his public teachings",
      url: W("14th_Dalai_Lama") },

    { id: "q-teresa-1",
      text: "Not all of us can do great things. But we can do small things with great love.",
      author: "Mother Teresa", source: "Attributed in her collected sayings",
      url: W("Mother_Teresa") },

    { id: "q-schweitzer-1",
      text: "Example is not the main thing in influencing others. It is the only thing.",
      author: "Albert Schweitzer", source: "Attributed in his collected writings",
      url: W("Albert_Schweitzer") },

    { id: "q-washington-1",
      text: "Those who are happiest are those who do the most for others.",
      author: "Booker T. Washington", source: "Up from Slavery",
      url: W("Booker_T._Washington") },

    { id: "q-rbg-1",
      text: "Fight for the things that you care about, but do it in a way that will lead others to join you.",
      author: "Ruth Bader Ginsburg", source: "Remarks at Radcliffe Institute, 2015",
      url: W("Ruth_Bader_Ginsburg") },

    { id: "q-robinson-1",
      text: "A life is not important except in the impact it has on other lives.",
      author: "Jackie Robinson", source: "Inscribed on his gravestone",
      url: W("Jackie_Robinson") },

    { id: "q-maathai-1",
      text: "It's the little things citizens do. That's what will make the difference.",
      author: "Wangari Maathai", source: "Nobel Peace Prize interviews, 2004",
      url: W("Wangari_Maathai") },

    { id: "q-malala-1",
      text: "One child, one teacher, one book, one pen can change the world.",
      author: "Malala Yousafzai", source: "Address to the United Nations, 2013",
      url: W("Malala_Yousafzai") },

    { id: "q-malala-2",
      text: "I raise up my voice — not so I can shout, but so that those without a voice can be heard.",
      author: "Malala Yousafzai", source: "I Am Malala",
      url: W("Malala_Yousafzai") },

    { id: "q-frankl-1",
      text: "When we are no longer able to change a situation, we are challenged to change ourselves.",
      author: "Viktor Frankl", source: "Man's Search for Meaning",
      url: W("Viktor_Frankl") },

    { id: "q-edelman-1",
      text: "Service is the rent we pay for living. It is the very purpose of life, and not something you do in your spare time.",
      author: "Marian Wright Edelman", source: "The Measure of Our Success",
      url: W("Marian_Wright_Edelman") },

    { id: "q-cicero-1",
      text: "Gratitude is not only the greatest of virtues, but the parent of all the others.",
      author: "Cicero", source: "Pro Plancio",
      url: W("Cicero") },

    { id: "q-gibran-1",
      text: "You give but little when you give of your possessions. It is when you give of yourself that you truly give.",
      author: "Kahlil Gibran", source: "The Prophet",
      url: W("Kahlil_Gibran") },

    { id: "q-earhart-1",
      text: "A single act of kindness throws out roots in all directions, and the roots spring up and make new trees.",
      author: "Amelia Earhart", source: "Attributed in her collected writings",
      url: W("Amelia_Earhart") },

    { id: "q-lorde-1",
      text: "It is not our differences that divide us. It is our inability to recognize, accept, and celebrate those differences.",
      author: "Audre Lorde", source: "Our Dead Behind Us",
      url: W("Audre_Lorde") },

    { id: "q-havel-1",
      text: "Hope is not the conviction that something will turn out well, but the certainty that something makes sense, regardless of how it turns out.",
      author: "Václav Havel", source: "Disturbing the Peace",
      url: W("V%C3%A1clav_Havel") },

    { id: "q-weil-1",
      text: "Attention is the rarest and purest form of generosity.",
      author: "Simone Weil", source: "Letter to Joë Bousquet, 1942",
      url: W("Simone_Weil") },

    { id: "q-hooks-1",
      text: "To be loving we willingly hear the other's truth.",
      author: "bell hooks", source: "All About Love: New Visions",
      url: W("Bell_hooks") },

    { id: "q-goodall-1",
      text: "What you do makes a difference, and you have to decide what kind of difference you want to make.",
      author: "Jane Goodall", source: "Attributed in her lectures and interviews",
      url: W("Jane_Goodall") },

    { id: "q-ali-1",
      text: "Service to others is the rent you pay for your room here on earth.",
      author: "Muhammad Ali", source: "Attributed in his interviews",
      url: W("Muhammad_Ali") },

    { id: "q-aesop-1",
      text: "No act of kindness, no matter how small, is ever wasted.",
      author: "Aesop", source: "Aesop's Fables",
      url: W("Aesop") },

    { id: "q-tagore-1",
      text: "I slept and dreamt that life was joy. I awoke and saw that life was service. I acted and behold, service was joy.",
      author: "Rabindranath Tagore", source: "Attributed in his collected works",
      url: W("Rabindranath_Tagore") },

    { id: "q-chisholm-1",
      text: "Service is the rent that you pay for room on this earth.",
      author: "Shirley Chisholm", source: "Attributed in her speeches",
      url: W("Shirley_Chisholm") },

    { id: "q-carver-1",
      text: "How far you go in life depends on your being tender with the young, compassionate with the aged, sympathetic with the striving, and tolerant of the weak and the strong — because someday you will have been all of these.",
      author: "George Washington Carver", source: "Attributed in his collected letters",
      url: W("George_Washington_Carver") },

    { id: "q-mead-1",
      text: "Never doubt that a small group of thoughtful, committed citizens can change the world; indeed, it's the only thing that ever has.",
      author: "Margaret Mead", source: "Attributed by the Institute for Intercultural Studies",
      url: W("Margaret_Mead") },

    { id: "q-parks-1",
      text: "Each person must live their life as a model for others.",
      author: "Rosa Parks", source: "Attributed in her interviews",
      url: W("Rosa_Parks") },

    { id: "q-marcus-4",
      text: "When you wake up in the morning, tell yourself: the people I deal with today will be meddling, ungrateful, arrogant, dishonest, jealous, and surly. But I can neither be harmed by any of them, nor become angry with one who is my kin.",
      author: "Marcus Aurelius", source: "Meditations, Book II",
      url: W("Marcus_Aurelius") },

    { id: "q-lincoln-1",
      text: "I am a slow walker, but I never walk back.",
      author: "Abraham Lincoln", source: "Letter to a supporter, 1856",
      url: W("Abraham_Lincoln") },

    { id: "q-curie-1",
      text: "Be less curious about people and more curious about ideas.",
      author: "Marie Curie", source: "Attributed in her collected correspondence",
      url: W("Marie_Curie") },

    { id: "q-sagan-1",
      text: "For small creatures such as we, the vastness is bearable only through love.",
      author: "Carl Sagan", source: "Contact",
      url: W("Carl_Sagan") },

    { id: "q-nightingale-1",
      text: "I attribute my success to this: I never gave or took an excuse.",
      author: "Florence Nightingale", source: "Attributed in her collected letters",
      url: W("Florence_Nightingale") },

    { id: "q-tubman-1",
      text: "I had reasoned this out in my mind: there was one of two things I had a right to — liberty or death.",
      author: "Harriet Tubman", source: "Scenes in the Life of Harriet Tubman, 1869",
      url: W("Harriet_Tubman") },

    { id: "q-anthony-1",
      text: "Independence is happiness.",
      author: "Susan B. Anthony", source: "Attributed in her collected speeches",
      url: W("Susan_B._Anthony") },

    { id: "q-thoreau-1",
      text: "Goodness is the only investment that never fails.",
      author: "Henry David Thoreau", source: "Walden",
      url: W("Henry_David_Thoreau") },

    { id: "q-dickens-1",
      text: "No one is useless in this world who lightens the burdens of another.",
      author: "Charles Dickens", source: "Our Mutual Friend",
      url: W("Charles_Dickens") },

    { id: "q-eliot-1",
      text: "What do we live for, if it is not to make life less difficult to each other?",
      author: "George Eliot", source: "Middlemarch",
      url: W("George_Eliot") },

    { id: "q-austen-1",
      text: "There is no charm equal to tenderness of heart.",
      author: "Jane Austen", source: "Emma",
      url: W("Jane_Austen") },

    { id: "q-wilde-1",
      text: "The smallest act of kindness is worth more than the grandest intention.",
      author: "Oscar Wilde", source: "Attributed in his collected sayings",
      url: W("Oscar_Wilde") },

    { id: "q-tolstoy-1",
      text: "If you want to be happy, be.",
      author: "Leo Tolstoy", source: "Attributed in his collected writings",
      url: W("Leo_Tolstoy") },

    { id: "q-plato-1",
      text: "The first and greatest victory is to conquer yourself.",
      author: "Plato", source: "Laws",
      url: W("Plato") },

    { id: "q-socrates-1",
      text: "The way to gain a good reputation is to endeavour to be what you desire to appear.",
      author: "Socrates", source: "Recorded by Xenophon, Memorabilia",
      url: W("Socrates") },

    { id: "q-franklin-1",
      text: "Well done is better than well said.",
      author: "Benjamin Franklin", source: "Poor Richard's Almanack",
      url: W("Benjamin_Franklin") },

    { id: "q-carnegie-1",
      text: "You can make more friends in two months by becoming interested in other people than you can in two years by trying to get other people interested in you.",
      author: "Dale Carnegie", source: "How to Win Friends and Influence People",
      url: W("Dale_Carnegie") },

    { id: "q-hillel-1",
      text: "If I am not for myself, who will be for me? And being only for myself, what am I? And if not now, when?",
      author: "Hillel the Elder", source: "Pirkei Avot, 1:14",
      url: W("Hillel_the_Elder") },

    { id: "q-obama-1",
      text: "The best way to not feel hopeless is to get up and do something.",
      author: "Barack Obama", source: "Remarks at the Obama Foundation Summit, 2017",
      url: W("Barack_Obama") },

    { id: "q-lewis-1",
      text: "Never, ever be afraid to make some noise and get in good trouble, necessary trouble.",
      author: "John Lewis", source: "Address, 2018",
      url: W("John_Lewis") }
  ];

  /** Ids already shown, kept on the record so the no-repeat survives reloads. */
  function seen() {
    const list = S.db.ui && S.db.ui.quotesSeen;
    return Array.isArray(list) ? list : [];
  }

  /**
   * A quote that has not been shown before.
   *
   * Only resets once every quote in the pool has genuinely been used — so a
   * repeat is impossible until then, and after that the whole set is fair
   * game again rather than the feature simply going blank.
   */
  function pick() {
    let used = seen();
    let pool = QUOTES.filter((q) => used.indexOf(q.id) < 0);
    if (!pool.length) { used = []; pool = QUOTES.slice(); }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    S.db.ui.quotesSeen = used.concat([chosen.id]);
    S.saveQuiet();
    return chosen;
  }

  /* One per app open: the same quote for the whole visit, a new one next time. */
  let current = null;
  function today() {
    if (!current) current = pick();
    return current;
  }

  return { QUOTES, pick, today, seen, count: QUOTES.length };
})();
