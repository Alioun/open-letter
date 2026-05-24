const KV_TO_STATE = new Map([
  ["Berlin", "Berlin"],
  ["Berlin-Neukölln", "Berlin"],
  ["Spandau", "Berlin"],
  ["Lichtenberg", "Berlin"],
  ["Tempelhof-Schöneberg", "Berlin"],
  ["Treptow-Köpenick", "Berlin"],
  ["Treptow Köpenick", "Berlin"],
  ["Moabit", "Berlin"],
  ["Pankow", "Berlin"],
  ["Marzahn-Hellersdorf", "Berlin"],

  ["Hamburg", "Hamburg"],
  ["Bremen", "Bremen"],

  ["Köln", "Nordrhein-Westfalen"],
  ["Düsseldorf", "Nordrhein-Westfalen"],
  ["Bonn", "Nordrhein-Westfalen"],
  ["Dortmund", "Nordrhein-Westfalen"],
  ["Essen", "Nordrhein-Westfalen"],
  ["Duisburg", "Nordrhein-Westfalen"],
  ["Bochum", "Nordrhein-Westfalen"],
  ["Bielefeld", "Nordrhein-Westfalen"],
  ["Münster", "Nordrhein-Westfalen"],
  ["Wuppertal", "Nordrhein-Westfalen"],
  ["Aachen", "Nordrhein-Westfalen"],
  ["Heinsberg", "Nordrhein-Westfalen"],

  ["München", "Bayern"],
  ["Nürnberg", "Bayern"],
  ["Augsburg", "Bayern"],
  ["Regensburg", "Bayern"],
  ["Würzburg", "Bayern"],
  ["Erlangen", "Bayern"],
  ["Fürth", "Bayern"],

  ["Stuttgart", "Baden-Württemberg"],
  ["Freiburg", "Baden-Württemberg"],
  ["Karlsruhe", "Baden-Württemberg"],
  ["Heidelberg", "Baden-Württemberg"],
  ["Mannheim", "Baden-Württemberg"],
  ["Tübingen", "Baden-Württemberg"],
  ["Konstanz", "Baden-Württemberg"],
  ["Esslingen", "Baden-Württemberg"],
  ["Ludwigsburg", "Baden-Württemberg"],
  ["Reutlingen", "Baden-Württemberg"],
  ["Lörrach", "Baden-Württemberg"],
  ["Ravensburg", "Baden-Württemberg"],
  ["Pforzheim", "Baden-Württemberg"],

  ["Hannover", "Niedersachsen"],
  ["Oldenburg", "Niedersachsen"],
  ["Osnabrück", "Niedersachsen"],
  ["Braunschweig", "Niedersachsen"],
  ["Göttingen", "Niedersachsen"],
  ["Wolfenbüttel", "Niedersachsen"],
  ["Lüneburg", "Niedersachsen"],
  ["Hameln", "Niedersachsen"],

  ["Frankfurt am Main", "Hessen"],
  ["Kassel", "Hessen"],
  ["Marburg", "Hessen"],
  ["Darmstadt", "Hessen"],
  ["Wiesbaden", "Hessen"],
  ["Offenbach", "Hessen"],

  ["Leipzig", "Sachsen"],
  ["Dresden", "Sachsen"],
  ["Chemnitz", "Sachsen"],
  ["Zwickau", "Sachsen"],

  ["Erfurt", "Thüringen"],
  ["Jena", "Thüringen"],

  ["Magdeburg", "Sachsen-Anhalt"],
  ["Halle (Saale)", "Sachsen-Anhalt"],

  ["Potsdam", "Brandenburg"],
  ["Brandenburg", "Brandenburg"],

  ["Kiel", "Schleswig-Holstein"],
  ["Lübeck", "Schleswig-Holstein"],
  ["Flensburg", "Schleswig-Holstein"],

  ["Rostock", "Mecklenburg-Vorpommern"],

  ["Mainz", "Rheinland-Pfalz"],
  ["Saarbrücken", "Saarland"],

  ["Region Hannover", "Niedersachsen"],
  ["Bodenseekreis", "Baden-Württemberg"],
  ["Calw-Freudenstadt", "Baden-Württemberg"],
  ["Sigmaringen-Zollernalb", "Baden-Württemberg"],
  ["Breisgau-Hochschwarzwald", "Baden-Württemberg"],
  ["Ortenau", "Baden-Württemberg"],
  ["Waldshut", "Baden-Württemberg"],
  ["Ilm-Kreis", "Thüringen"],
  ["Lahn-Dill Kreis", "Hessen"],
  ["Traunstein-BGL", "Bayern"],
  ["Uckermark", "Brandenburg"],
  ["Allgäu", "Bayern"],
]);

const PATTERNS = [
  [/^(Berlin|BV Berlin|SDS.*(Berlin|Tu berlin))/i, "Berlin"],
  [/^Stellvertretende.*Berlin/i, "Berlin"],
  [/^Hamburg/i, "Hamburg"],
  [/^(Leipzig|SDS Leipzig)/i, "Sachsen"],
  [/^K[öõ]ln/i, "Nordrhein-Westfalen"],
  [/^Bremen/i, "Bremen"],
  [/^Stuttgart/i, "Baden-Württemberg"],
  [/^Mainz/i, "Rheinland-Pfalz"],
  [/Magdeburg/i, "Sachsen-Anhalt"],
  [/^Halle/i, "Sachsen-Anhalt"],
  [/^Heidelberg/i, "Baden-Württemberg"],
  [/^Rhein.?Sieg/i, "Nordrhein-Westfalen"],
  [/^Os[tr]alb/i, "Baden-Württemberg"],
  [/^Pforzheim/i, "Baden-Württemberg"],
  [/^Erlangen/i, "Bayern"],
  [/^Hameln/i, "Niedersachsen"],
  [/^(Offenbach|Rodgau)/i, "Hessen"],
  [/^Heinsberg/i, "Nordrhein-Westfalen"],
  [/^Rhein.?Hardt|^Rhein.?Lahn/i, "Rheinland-Pfalz"],
  [/^Brandenburg/i, "Brandenburg"],
  [/^Aalen/i, "Baden-Württemberg"],
  [/oberberg/i, "Nordrhein-Westfalen"],
  [/oberland/i, "Bayern"],
];

export function resolveState(kreisverband) {
  if (!kreisverband) return null;

  const exact = KV_TO_STATE.get(kreisverband);
  if (exact) return exact;

  for (const [pattern, state] of PATTERNS) {
    if (pattern.test(kreisverband)) return state;
  }

  return null;
}
