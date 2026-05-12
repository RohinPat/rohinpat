// Everything personal lives here — edit freely.
// Placeholders are marked with TODO.

export const watches = {
  rotation: [
    {
      name: "Rolex Submariner — \"Starbucks\"",
      detail: "126610LV · green bezel",
      caliber: "3235 · automatic",
      size: "41mm Oystersteel",
      strap: "Oyster bracelet",
      note: "The one I save for occasions. The green grows on you.",
    },
    {
      name: "Omega × Swatch Mission to the Moon",
      detail: "OG MoonSwatch · 2022",
      caliber: "ETA G10.212 · quartz",
      size: "42mm Bioceramic",
      strap: "Velcro",
      note: "Lined up for it. Worth the line.",
    },
    {
      name: "Omega × Swatch Mission to the Moonphase — New Moon",
      detail: "White moonphase · 2023",
      caliber: "ETA · quartz w/ moonphase",
      size: "42mm Bioceramic",
      strap: "Velcro",
      note: "Hidden Snoopy if you catch it right.",
    },
  ],
  wishlist: [
    {
      name: "Grand Seiko SBGA413 \"Shunbun\"",
      detail: "Cherry blossom dial · or the Lake Suwa (SBGH271)",
      note: "The grail. Whichever nature dial calls louder that week.",
    },
    {
      name: "F.P. Journe Chronomètre Bleu",
      detail: "Tantalum case · blue chrome dial · cal. 1304",
      note: "The watch-people's watch. Quietly the loudest thing in the room.",
    },
    {
      name: "Audemars Piguet Royal Oak Jumbo 16202",
      detail: "39mm steel · ultra-thin · 50th anniversary",
      note: "If only one Royal Oak ever, the one Gérald Genta drew.",
    },
  ],
} as const;

export const cars = {
  current: {
    year: "Daily",
    make: "Lexus",
    model: "RX350",
    spec: "2GR · V6 · AWD · the sensible one",
    note: "Quiet. Boring. Runs forever. The car I actually drive.",
  },
  dreams: [
    {
      tier: "Everyday dream",
      year: "1990",
      make: "Mercedes-Benz",
      model: "W124 E-Class",
      spec: "M104 inline-six · indestructible",
      note: "The watchmaker's car. Daily forever.",
    },
    {
      tier: "Weekend dream",
      year: "2023",
      make: "Porsche",
      model: "992 GT3 RS",
      spec: "4.0L NA flat-six · 525hp · PDK · the swan song",
      note: "If I sell the company.",
    },
    {
      tier: "Fantasy",
      year: "2024",
      make: "Lamborghini",
      model: "Huracán",
      spec: "5.2L V10 · 7-speed DCT · AWD",
      note: "Until reality intervenes. Or doesn't.",
    },
  ],
} as const;

export const barca = {
  legend: "Més que un club.",
  favoritePlayer: {
    name: "Neymar Jr.",
    number: 11,
    years: "2013–2017",
    note: "Four years that ruined my expectations of every other forward since.",
  },
  // Light vibes-only — no XI debates, no tactical breakdown.
  vibes: [
    "MSN at the front. Until it wasn't.",
    "The 6-1 night against PSG.",
    "Camp Nou after dark.",
    "Just a fan. That's the whole take.",
  ],
} as const;

export const music = {
  // Fallback when Spotify env vars aren't configured. When wired up, the live
  // /api/spotify/top-tracks endpoint takes over both on /play and /interests.
  // These are real long-term top 5 (replace with whatever you want shown when offline).
  rotation: [
    { artist: "Travis Scott",        track: "CAN'T SAY" },
    { artist: "Drake, Future, Young Thug", track: "Way 2 Sexy" },
    { artist: "21 Savage, Metro Boomin",   track: "Glock In My Lap" },
    { artist: "Travis Scott, Rob49, 21 Savage", track: "TOPIA TWINS" },
    { artist: "Travis Scott",        track: "way back" },
  ],
  topAlbums: [
    "Travis Scott — Astroworld",
    "Kanye West — My Beautiful Dark Twisted Fantasy",
    "Drake — Take Care",
    "21 Savage & Metro Boomin — Savage Mode II",
    "Mac Miller — Swimming",
  ],
  instruments: [
    { name: "French horn", since: 2014, note: "Six years of marching band." },
    { name: "Flute",       since: 2016, note: "Picked up later. Easier on the lungs." },
  ],
  // Spotify embed — works without the API. Edit to swap playlists.
  spotifyEmbed: "https://open.spotify.com/embed/playlist/364G4Hr4KtJzhWpoHz4MFf" as string | null,
} as const;

export const alsoInto = [
  {
    label: "Basketball",
    detail: "Celtics first. NBA League Pass on game nights.",
    hint: "Tatum era.",
  },
  {
    label: "Golf",
    detail: "Mid-handicap, working it down. Bag is mostly Callaway right now.",
    hint: "Home course: George Wright.",
  },
  {
    label: "Gaming",
    detail: "FIFA / EA FC, NBA 2K, a long-running CS habit.",
    hint: "PC + PS5.",
  },
  {
    label: "Skiing",
    detail: "Northeastern Downhill Skiers. East-coast ice, Vermont weekends.",
    hint: "Stowe / Sugarbush regulars.",
  },
  {
    label: "Mech keyboards",
    detail: "Hand-built. Lubed switches, FR4 plates, the whole rabbit hole.",
    hint: "Current daily: 65% layout.",
  },
  {
    label: "Chinese",
    detail: "Six years of study. 普通话 conversational, working on reading.",
    hint: "Mostly forgot 老外 by now.",
  },
] as const;
