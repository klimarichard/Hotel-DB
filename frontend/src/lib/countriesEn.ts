/**
 * Pure data module: the ENGLISH country name as printed on a hotel invoice.
 *
 * Keyed by ISO 3166-1 alpha-3 code, so this file pairs 1:1 with the Czech
 * names in lib/nationalities.ts — same codes, same order, so the two files
 * can be diffed side by side. Values are plain uppercase ASCII (no diacritics)
 * because that is the form printed on the document.
 *
 * ⚠️ Two deliberate deviations from the ISO English short name — these are what
 * the customer prints and must NOT be "corrected":
 *   - GBR = "GREAT BRITAIN"  (ISO says "UNITED KINGDOM")
 *   - CZE = "CZECH REPUBLIC" (ISO says "CZECHIA")
 */

export const COUNTRY_NAMES_EN: Record<string, string> = {
  AFG: "AFGHANISTAN", // Afghánistán
  ALA: "ALAND ISLANDS", // Ålandy
  ALB: "ALBANIA", // Albánie
  DZA: "ALGERIA", // Alžírsko
  ASM: "AMERICAN SAMOA", // Americká Samoa
  VIR: "US VIRGIN ISLANDS", // Americké Panenské ostrovy
  AND: "ANDORRA", // Andorra
  AGO: "ANGOLA", // Angola
  AIA: "ANGUILLA", // Anguilla
  ATA: "ANTARCTICA", // Antarktida
  ATG: "ANTIGUA AND BARBUDA", // Antigua a Barbuda
  ARG: "ARGENTINA", // Argentina
  ARM: "ARMENIA", // Arménie
  ABW: "ARUBA", // Aruba
  AUS: "AUSTRALIA", // Austrálie
  AZE: "AZERBAIJAN", // Ázerbájdžán
  BHS: "BAHAMAS", // Bahamy
  BHR: "BAHRAIN", // Bahrajn
  BGD: "BANGLADESH", // Bangladéš
  BRB: "BARBADOS", // Barbados
  BEL: "BELGIUM", // Belgie
  BLZ: "BELIZE", // Belize
  BLR: "BELARUS", // Bělorusko
  BEN: "BENIN", // Benin
  BMU: "BERMUDA", // Bermudy
  BTN: "BHUTAN", // Bhútán
  BOL: "BOLIVIA", // Bolívie
  BES: "BONAIRE, SINT EUSTATIUS AND SABA", // Bonaire, Svatý Eustach a Saba
  BIH: "BOSNIA AND HERZEGOVINA", // Bosna a Hercegovina
  BWA: "BOTSWANA", // Botswana
  BVT: "BOUVET ISLAND", // Bouvetův ostrov
  BRA: "BRAZIL", // Brazílie
  IOT: "BRITISH INDIAN OCEAN TERRITORY", // Britské indickooceánské území
  VGB: "BRITISH VIRGIN ISLANDS", // Britské Panenské ostrovy
  BRN: "BRUNEI", // Brunej
  BGR: "BULGARIA", // Bulharsko
  BFA: "BURKINA FASO", // Burkina Faso
  BDI: "BURUNDI", // Burundi
  COK: "COOK ISLANDS", // Cookovy ostrovy
  CUW: "CURACAO", // Curaçao
  TCD: "CHAD", // Čad
  MNE: "MONTENEGRO", // Černá Hora
  CZE: "CZECH REPUBLIC", // Česko
  CHN: "CHINA", // Čína
  DNK: "DENMARK", // Dánsko
  COD: "DEMOCRATIC REPUBLIC OF THE CONGO", // Demokratická republika Kongo
  DMA: "DOMINICA", // Dominika
  DOM: "DOMINICAN REPUBLIC", // Dominikánská republika
  DJI: "DJIBOUTI", // Džibutsko
  EGY: "EGYPT", // Egypt
  ECU: "ECUADOR", // Ekvádor
  ERI: "ERITREA", // Eritrea
  EST: "ESTONIA", // Estonsko
  ETH: "ETHIOPIA", // Etiopie
  FRO: "FAROE ISLANDS", // Faerské ostrovy
  FLK: "FALKLAND ISLANDS", // Falklandy
  FJI: "FIJI", // Fidži
  PHL: "PHILIPPINES", // Filipíny
  FIN: "FINLAND", // Finsko
  FRA: "FRANCE", // Francie
  GUF: "FRENCH GUIANA", // Francouzská Guyana
  ATF: "FRENCH SOUTHERN TERRITORIES", // Francouzská jižní a antarktická území
  PYF: "FRENCH POLYNESIA", // Francouzská Polynésie
  GAB: "GABON", // Gabon
  GMB: "GAMBIA", // Gambie
  GHA: "GHANA", // Ghana
  GIB: "GIBRALTAR", // Gibraltar
  GRD: "GRENADA", // Grenada
  GRL: "GREENLAND", // Grónsko
  GEO: "GEORGIA", // Gruzie
  GLP: "GUADELOUPE", // Guadeloupe
  GUM: "GUAM", // Guam
  GTM: "GUATEMALA", // Guatemala
  GGY: "GUERNSEY", // Guernsey
  GIN: "GUINEA", // Guinea
  GNB: "GUINEA-BISSAU", // Guinea-Bissau
  GUY: "GUYANA", // Guyana
  HTI: "HAITI", // Haiti
  HMD: "HEARD ISLAND AND MCDONALD ISLANDS", // Heardův ostrov a McDonaldovy ostrovy
  HND: "HONDURAS", // Honduras
  HKG: "HONG KONG", // Hongkong
  CHL: "CHILE", // Chile
  HRV: "CROATIA", // Chorvatsko
  IND: "INDIA", // Indie
  IDN: "INDONESIA", // Indonésie
  IRQ: "IRAQ", // Irák
  IRN: "IRAN", // Írán
  IRL: "IRELAND", // Irsko
  ISL: "ICELAND", // Island
  ITA: "ITALY", // Itálie
  ISR: "ISRAEL", // Izrael
  JAM: "JAMAICA", // Jamajka
  JPN: "JAPAN", // Japonsko
  YEM: "YEMEN", // Jemen
  JEY: "JERSEY", // Jersey
  ZAF: "SOUTH AFRICA", // Jihoafrická republika
  SGS: "SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS", // Jižní Georgie a Jižní Sandwichovy ostrovy
  SSD: "SOUTH SUDAN", // Jižní Súdán
  JOR: "JORDAN", // Jordánsko
  CYM: "CAYMAN ISLANDS", // Kajmanské ostrovy
  KHM: "CAMBODIA", // Kambodža
  CMR: "CAMEROON", // Kamerun
  CAN: "CANADA", // Kanada
  CPV: "CAPE VERDE", // Kapverdy
  QAT: "QATAR", // Katar
  KAZ: "KAZAKHSTAN", // Kazachstán
  KEN: "KENYA", // Keňa
  KIR: "KIRIBATI", // Kiribati
  CCK: "COCOS ISLANDS", // Kokosové ostrovy
  COL: "COLOMBIA", // Kolumbie
  COM: "COMOROS", // Komory
  COG: "CONGO", // Kongo
  KOR: "SOUTH KOREA", // Korejská republika
  PRK: "NORTH KOREA", // Korejská lidově demokratická republika
  XKX: "KOSOVO", // Kosovo
  CRI: "COSTA RICA", // Kostarika
  CUB: "CUBA", // Kuba
  KWT: "KUWAIT", // Kuvajt
  CYP: "CYPRUS", // Kypr
  KGZ: "KYRGYZSTAN", // Kyrgyzstán
  LAO: "LAOS", // Laos
  LSO: "LESOTHO", // Lesotho
  LBN: "LEBANON", // Libanon
  LBR: "LIBERIA", // Libérie
  LBY: "LIBYA", // Libye
  LIE: "LIECHTENSTEIN", // Lichtenštejnsko
  LTU: "LITHUANIA", // Litva
  LVA: "LATVIA", // Lotyšsko
  LUX: "LUXEMBOURG", // Lucembursko
  MAC: "MACAO", // Macao
  MDG: "MADAGASCAR", // Madagaskar
  HUN: "HUNGARY", // Maďarsko
  MKD: "NORTH MACEDONIA", // Severní Makedonie
  MYS: "MALAYSIA", // Malajsie
  MWI: "MALAWI", // Malawi
  MDV: "MALDIVES", // Maledivy
  MLI: "MALI", // Mali
  MLT: "MALTA", // Malta
  MAR: "MOROCCO", // Maroko
  MHL: "MARSHALL ISLANDS", // Marshallovy ostrovy
  MTQ: "MARTINIQUE", // Martinik
  MUS: "MAURITIUS", // Mauricius
  MRT: "MAURITANIA", // Mauritánie
  MYT: "MAYOTTE", // Mayotte
  MEX: "MEXICO", // Mexiko
  FSM: "MICRONESIA", // Mikronésie
  MDA: "MOLDOVA", // Moldavsko
  MCO: "MONACO", // Monako
  MNG: "MONGOLIA", // Mongolsko
  MSR: "MONTSERRAT", // Montserrat
  MOZ: "MOZAMBIQUE", // Mosambik
  MMR: "MYANMAR", // Myanmar
  NAM: "NAMIBIA", // Namibie
  NRU: "NAURU", // Nauru
  DEU: "GERMANY", // Německo
  NPL: "NEPAL", // Nepál
  NER: "NIGER", // Niger
  NGA: "NIGERIA", // Nigérie
  NIC: "NICARAGUA", // Nikaragua
  NIU: "NIUE", // Niue
  NLD: "NETHERLANDS", // Nizozemsko
  NFK: "NORFOLK ISLAND", // Norfolk
  NOR: "NORWAY", // Norsko
  NCL: "NEW CALEDONIA", // Nová Kaledonie
  NZL: "NEW ZEALAND", // Nový Zéland
  OMN: "OMAN", // Omán
  PAK: "PAKISTAN", // Pákistán
  PLW: "PALAU", // Palau
  PSE: "PALESTINE", // Palestina
  PAN: "PANAMA", // Panama
  PNG: "PAPUA NEW GUINEA", // Papua-Nová Guinea
  PRY: "PARAGUAY", // Paraguay
  PER: "PERU", // Peru
  PCN: "PITCAIRN ISLANDS", // Pitcairnovy ostrovy
  CIV: "IVORY COAST", // Pobřeží slonoviny
  POL: "POLAND", // Polsko
  PRI: "PUERTO RICO", // Portoriko
  PRT: "PORTUGAL", // Portugalsko
  AUT: "AUSTRIA", // Rakousko
  REU: "REUNION", // Réunion
  GNQ: "EQUATORIAL GUINEA", // Rovníková Guinea
  ROU: "ROMANIA", // Rumunsko
  RUS: "RUSSIA", // Rusko
  RWA: "RWANDA", // Rwanda
  GRC: "GREECE", // Řecko
  SPM: "SAINT PIERRE AND MIQUELON", // Saint-Pierre a Miquelon
  SLV: "EL SALVADOR", // Salvador
  WSM: "SAMOA", // Samoa
  SMR: "SAN MARINO", // San Marino
  SAU: "SAUDI ARABIA", // Saúdská Arábie
  SEN: "SENEGAL", // Senegal
  MNP: "NORTHERN MARIANA ISLANDS", // Severní Mariany
  SYC: "SEYCHELLES", // Seychely
  SLE: "SIERRA LEONE", // Sierra Leone
  SGP: "SINGAPORE", // Singapur
  SXM: "SINT MAARTEN", // Sint Maarten
  SVK: "SLOVAKIA", // Slovensko
  SVN: "SLOVENIA", // Slovinsko
  SOM: "SOMALIA", // Somálsko
  ARE: "UNITED ARAB EMIRATES", // Spojené arabské emiráty
  GBR: "GREAT BRITAIN", // Spojené království
  USA: "UNITED STATES OF AMERICA", // Spojené státy americké
  UMI: "UNITED STATES MINOR OUTLYING ISLANDS", // Menší odlehlé ostrovy USA
  SRB: "SERBIA", // Srbsko
  LKA: "SRI LANKA", // Srí Lanka
  CAF: "CENTRAL AFRICAN REPUBLIC", // Středoafrická republika
  SDN: "SUDAN", // Súdán
  SUR: "SURINAME", // Surinam
  SHN: "SAINT HELENA", // Svatá Helena
  LCA: "SAINT LUCIA", // Svatá Lucie
  BLM: "SAINT BARTHELEMY", // Svatý Bartoloměj
  KNA: "SAINT KITTS AND NEVIS", // Svatý Kryštof a Nevis
  MAF: "SAINT MARTIN (FRENCH PART)", // Svatý Martin (FR)
  STP: "SAO TOME AND PRINCIPE", // Svatý Tomáš a Princův ostrov
  VCT: "SAINT VINCENT AND THE GRENADINES", // Svatý Vincenc a Grenadiny
  SWZ: "ESWATINI", // Svazijsko
  SYR: "SYRIA", // Sýrie
  SLB: "SOLOMON ISLANDS", // Šalomounovy ostrovy
  ESP: "SPAIN", // Španělsko
  SJM: "SVALBARD AND JAN MAYEN", // Špicberky a Jan Mayen
  SWE: "SWEDEN", // Švédsko
  CHE: "SWITZERLAND", // Švýcarsko
  TJK: "TAJIKISTAN", // Tádžikistán
  TZA: "TANZANIA", // Tanzanie
  THA: "THAILAND", // Thajsko
  TWN: "TAIWAN", // Tchaj-wan
  TGO: "TOGO", // Togo
  TKL: "TOKELAU", // Tokelau
  TON: "TONGA", // Tonga
  TTO: "TRINIDAD AND TOBAGO", // Trinidad a Tobago
  TUN: "TUNISIA", // Tunisko
  TUR: "TURKEY", // Turecko
  TKM: "TURKMENISTAN", // Turkmenistán
  TCA: "TURKS AND CAICOS ISLANDS", // Turks a Caicos
  TUV: "TUVALU", // Tuvalu
  UGA: "UGANDA", // Uganda
  UKR: "UKRAINE", // Ukrajina
  URY: "URUGUAY", // Uruguay
  UZB: "UZBEKISTAN", // Uzbekistán
  CXR: "CHRISTMAS ISLAND", // Vánoční ostrov
  VUT: "VANUATU", // Vanuatu
  VAT: "VATICAN CITY", // Vatikán
  VEN: "VENEZUELA", // Venezuela
  VNM: "VIETNAM", // Vietnam
  TLS: "EAST TIMOR", // Východní Timor
  WLF: "WALLIS AND FUTUNA", // Wallis a Futuna
  ZMB: "ZAMBIA", // Zambie
  ESH: "WESTERN SAHARA", // Západní Sahara
  ZWE: "ZIMBABWE", // Zimbabwe
};
