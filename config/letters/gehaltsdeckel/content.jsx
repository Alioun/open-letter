// Per-letter rich page content for the "Gehaltsdeckel jetzt" campaign.
//
// These are React components (JSX) imported only by the frontend (src/App.jsx via
// config/content.jsx). A new letter provides its own version of this file. The
// markup was moved here verbatim from the original App.jsx so rendering is
// unchanged.

// The open letter itself. `total` is the live verified-signature count, used in
// the closing signatory line.
export function LetterArticle({ total }) {
  return (
            <article className="brief-paper" aria-labelledby="brief-heading">
              <h2 id="brief-heading">Ein Brief von Genoss*innen</h2>
              <p className="anrede">Liebe Genoss*innen,</p>

              <p className="lead">
                in diesem Brief melden wir uns als aktive Mitglieder der Linken
                - mit und ohne Funktion - zu Wort. Wir wollen uns konstruktiv in
                die Debatte um den Gehaltsdeckel für Mandatsträger*innen
                einbringen, die in den vergangenen Wochen teils unschön über die
                Medien geführt wurde. Denn es ist uns wichtig, dass unsere
                Perspektive gehört wird.
              </p>

              <p>
                Der Parteivorstand hat dem nächsten Bundesparteitag in Potsdam
                einen Antrag zur Begrenzung der Diäten von Mandatsträger*innen
                vorgelegt. Für uns ist dieser Antrag absolut richtig und längst
                überfällig. Denn natürlich ist in einer Partei wie der Linken
                die Rolle von Mandatsträger*innen und ihr Verhältnis zur Partei
                eine zentrale politische Frage. Wir wollen über den Diätendeckel
                demokratisch diskutieren, und zwar auf dem Parteitag. Genau dort
                gehört diese Auseinandersetzung hin und nicht in die Presse.
              </p>

              <p>
                Das Comeback 2025 wurde nicht von Mandatsträger*innen allein
                ermöglicht. Es wurde von tausenden Mitgliedern getragen, die
                ihre Feierabende, ihre Wochenenden und ihre Energie mit
                Wahlkampf verbracht haben. Von Genoss*innen, die geblieben sind,
                als es schwierig war. Die Infostände organisiert, an
                hunderttausende Haustüren geklopft und zehntausende Plakate
                aufgehängt haben.
              </p>

              <blockquote className="pullquote">
                „Die Linke wurde von uns allen gerettet, und zwar neben Beruf,
                Familie oder Studium und ohne jegliche öffentliche
                Aufmerksamkeit."
              </blockquote>

              <p>
                Wir erwarten, dass Mandate in der Linken anders verstanden
                werden als in anderen Parteien: als politische Verantwortung
                gegenüber der Partei und den Menschen, die sie tragen. Wenn wir
                sagen, dass wir als Linke Politik anders machen wollen, dann
                muss sich dieser Anspruch auch in unserer politischen Praxis
                widerspiegeln. Gerade in unserer Partei, die beinahe daran
                zerbrochen wäre, dass einzelne Funktionär*innen sie für
                persönliche Interessen missbraucht haben, ist die Debatte über
                die Rolle und Verantwortung von Abgeordneten selbstverständlich.
                Denn Mandatsträger*innen sind Aushängeschilder unserer Politik.
                An ihrem Auftreten wird Die Linke insgesamt gemessen. Wenn
                unsere Mandatsträger*innen ihre Diäten wirksam begrenzen und
                Geld zugunsten von Sozialfonds und sozialen Initiativen
                umverteilen, dann stärkt das die Glaubwürdigkeit unserer Partei.
                Ein wirksamer Gehaltsdeckel ist es für uns nur, wenn wir uns an
                den Durchschnittslöhnen in diesem Land orientieren.
              </p>

              <p>
                Wir alle teilen eine Vision. Das Comeback 2025 war nur der erste
                Schritt. Wir wollen Die Linke weiter aufbauen, Menschen
                organisieren und so eine nachhaltige sozialistische Politik
                schaffen. In den letzten Monaten haben wir erlebt, zu was wir in
                der Lage sind, wenn wir an einem Strang ziehen. Genau diesen Weg
                wollen wir fortsetzen, denn wir haben viel zu tun und die
                Herausforderungen sind groß.
              </p>

              <p>
                Wir erwarten von allen, auch denen, die gegen einen
                Gehaltsdeckel sind, dass sie sich solidarisch und an den
                vorgesehenen Orten in diese Debatte einbringen. Auf Augenhöhe
                und innerhalb der Partei, statt über Medien. Denn die Aufgaben,
                vor denen wir stehen, gehen weit über einen Gehaltsdeckel
                hinaus. Unsere gemeinsame Aufgabe ist schließlich, Die Linke
                weiter aufzubauen. Das Comeback zur Bundestagswahl müssen wir in
                nachhaltige und glaubwürdige sozialistische Politik überführen.
              </p>

              <p className="gruss">Mit solidarischen Grüßen</p>

              <p className="signers-line">
                Marlen Borchardt, Philipp Möller, Lisbeth Ritterhoff, Zozan
                Bulut und
                <br />
                {(total - 4).toLocaleString("de-DE")} Mitglieder und
                Sympathisant*innen der Partei Die Linke
              </p>
            </article>
  );
}

// The FAQ block (intro aside + question list).
export function FaqContent() {
  return (
            <div className="faq-wrap">
              <aside className="faq-aside">
                <span className="num">04 / Fragen &amp; Antworten</span>
                <h2>
                  Häufige
                  <br />
                  Fragen.
                </h2>

                <div className="faq-intro">
                  <p>
                    Liebe Genoss*innen, mit diesen FAQ wollen wir die Debatte um
                    einen Gehaltsdeckel für unsere Abgeordneten im Bundestag und
                    Europaparlament mit ein paar Fakten unterlegen und euch eine
                    Argumentationshilfe geben, um die Debatte zu versachlichen
                    und unentschlossene Delegierte für den Bundesparteitag zu
                    überzeugen.
                  </p>
                  <p>
                    Achtung: Die Materie ist kompliziert, aber wir versuchen
                    unser Bestes, etwas Licht ins Dunkel zu bringen. Falls ihr
                    Fragen habt: Schreibt uns gerne eine Mail an{" "}
                    <a href="mailto:kontakt@gehaltsdeckel.jetzt">
                      kontakt@gehaltsdeckel.jetzt
                    </a>
                    . <em>(Stand: 9. Juni 2026)</em>
                  </p>
                </div>
              </aside>

              <div className="faq-list">
                <details className="faq-item">
                  <summary className="faq-q">
                    Der Parteivorstand hat einen Antrag für einen Gehaltsdeckel
                    für den Bundesparteitag im Juni vorgelegt. Welche Regelungen
                    sieht dieser Antrag vor?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Der Parteivorstand hat am 18. April 2026 einen Antrag für
                      den Bundesparteitag in Potsdam (19. Juni 2026)
                      beschlossen. Er sieht einen Gehaltsdeckel für unsere
                      Bundestags- und Europaabgeordneten vor, auch für die, die
                      bereits gewählt sind.
                    </p>
                    <p>
                      Der Deckel bezieht sich auf das arithmetische Mittel des
                      Bruttodurchschnittslohns aller Vollzeitbeschäftigten in
                      Deutschland — das sind derzeit 5.370 Euro brutto monatlich
                      (64.441 Euro jährlich, Stand 2025).¹ Netto bleiben den
                      Abgeordneten mindestens etwa 3.250 Euro pro Monat, je nach
                      Steuerklasse und persönlicher/familiärer Situation kann
                      diese Summe noch deutlich darüber liegen. Der Deckel ist
                      eine verbindliche Regelung, aber nicht gerichtlich
                      einklagbar.
                    </p>
                    <p>
                      Die Kostenpauschale (5.467 Euro monatlich) sowie die
                      Pauschale für die technische Ausstattung der Büros (12.000
                      Euro pro Jahr) sind vom Gehaltsdeckel ausgenommen.
                      Hinzukommen eine Bahncard 100 für alle MdBs sowie die
                      hohen Ansprüche zur Altersvorsorge (1.183 Euro brutto pro
                      Monat nach einer vierjährigen Legislatur)², die nicht vom
                      Gehaltsdeckel berührt werden.
                    </p>
                    <p>
                      Der Deckel ist ein Brutto-Deckel, d.h. zunächst werden auf
                      die volle Diät (für einen MdB aktuell 11.833 Euro brutto)
                      Steuern gezahlt und Krankenkassenbeiträge geleistet (MdBs
                      zahlen nicht in die Rente und Arbeitslosenversicherung
                      ein), auch die Mandatsträgerabgaben an die Partei werden
                      abgezogen. Erst danach greift der Deckel: der darüber
                      liegende Betrag wird abgeführt. Pro Kind und
                      pflegebedürftigem Angehörigen dürfen 350 Euro netto
                      zusätzlich behalten werden; für besondere Härtefälle gibt
                      es eine Ausnahmeregelung.
                    </p>
                    <p>
                      Das abgeführte Geld soll in einen Sozialfonds fließen —
                      für Sozialsprechstunden, Unterstützung von Menschen in Not
                      und politische Arbeit vor Ort. Aktuell unterstützt der
                      Landesvorstand in Baden-Württemberg den Antrag des
                      Parteivorstands.
                    </p>
                    <ul className="faq-footnotes">
                      <li>
                        ¹ Das entspricht ungefähr dem TVöD Bund E14, Stufe 1,
                        dieser beläuft sich aktuell auf 5298 Euro brutto
                        monatlich.
                      </li>
                      <li>
                        ² Damit erwerben MdBs nach einer Legislatur von 4 Jahren
                        aktuell Rentenansprüche, die einer 28-jährigen
                        Vollzeitbeschäftigung zum aktuellen Durchschnittslohn
                        entsprechen.
                      </li>
                    </ul>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Könnt ihr uns eine Beispielrechnung geben?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Ja klar, aber: Die Materie ist durch die unterschiedlichen
                      Steuerklassen, Sonderregelungen (z.B. Zuschläge für
                      Kinder) etwas kompliziert, daher haben wir hier ein
                      vereinfachtes Beispiel aufgeführt.
                    </p>
                    <p>
                      <strong>Erläuterung zu den Rechnungen:</strong> In dem
                      Beispiel sind jeweils zuerst die Abzüge eines MdBs
                      aufgeführt und der jeweilige Netto-Betrag, der ihnen
                      aktuell nach Abzügen von Steuer, Sozialversicherung und
                      Spenden zusteht. Dann folgt die Rechnung, was die
                      Einkommensgruppe, auf die sich der Gehaltsdeckel bezieht,
                      an Abzügen ihres Bruttoeinkommens hat. Aus der Differenz
                      zwischen den beiden Netto-Beträgen errechnet sich dann die
                      Summe, die durch den Deckel von der Diät abgezogen wird
                      und an den Sozialfonds, lokale Vereine und Projekte
                      fließt. Für Kinder, zu pflegende Angehörige oder in
                      Härtefällen kämen auf das Netto entsprechende Zuschläge.
                    </p>

                    <div className="faq-calc-grid">
                      <div className="faq-calc">
                        <p className="faq-calc-title">Beispiel 1</p>
                        <p className="faq-calc-sub">
                          MdB, unverheiratet, keine Kinder, Landesverband
                          Sachsen – Steuerklasse 1
                        </p>
                        <div className="faq-calc-row">
                          <span>Abgeordneten-Diät</span>
                          <span className="amount">11.833 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Lohnsteuer</span>
                          <span className="amount">− 3.733 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Soli</span>
                          <span className="amount">− 205 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>
                            Krankenversicherung{" "}
                            <span className="note">
                              (Höchstsatz, gesetzlich)
                            </span>
                          </span>
                          <span className="amount">− 509 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Pflegeversicherung</span>
                          <span className="amount">− 210 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>
                            Mandatsträgerabgabe{" "}
                            <span className="note">(15 % der Brutto-Diät)</span>
                          </span>
                          <span className="amount">− 1.775 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>
                            Mandatsträgerbeitrag Sachsen{" "}
                            <span className="note">
                              (5 %, das variiert in den Bundesländern)
                            </span>
                          </span>
                          <span className="amount">− 592 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Mitgliedsbeitrag Die Linke</span>
                          <span className="amount">− 190 €</span>
                        </div>
                        <div className="faq-calc-row faq-calc-row--result">
                          <span>Netto verbleibend</span>
                          <span className="amount">4.619 €</span>
                        </div>
                        <p className="faq-calc-note">
                          Hinweis: von diesem Netto gehen aktuell häufig noch
                          Spenden der MdBs an den Fraktionsverein und an lokale
                          Vereine und Projekte ab. Dies wäre aber auch mit einem
                          Deckel weiter möglich, würde aber transparenter
                          geregelt.
                        </p>
                      </div>

                      <div className="faq-calc">
                        <p className="faq-calc-title">
                          Gehaltsdeckel-Äquivalent
                        </p>
                        <p className="faq-calc-sub">
                          Arithmetisches Mittel des Bruttodurchschnittslohns
                          aller Vollzeitbeschäftigten in Deutschland,
                          unverheiratet, keine Kinder – Steuerklasse 1
                        </p>
                        <div className="faq-calc-row">
                          <span>Brutto-Einkommen</span>
                          <span className="amount">5.370 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Lohnsteuer</span>
                          <span className="amount">− 1.065 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Arbeitslosenversicherung</span>
                          <span className="amount">− 70 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Rentenversicherung</span>
                          <span className="amount">− 499 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Krankenversicherung</span>
                          <span className="amount">− 470 €</span>
                        </div>
                        <div className="faq-calc-row">
                          <span>Pflegeversicherung</span>
                          <span className="amount">− 129 €</span>
                        </div>
                        <div className="faq-calc-row faq-calc-row--result">
                          <span>Netto verbleibend</span>
                          <span className="amount">3.266 €</span>
                        </div>
                      </div>
                    </div>

                    <h4>Was wird nun gedeckelt?</h4>
                    <p>
                      Der Deckel greift für die Differenz zwischen dem Netto der
                      MdB-Diät und dem Netto des Durchschnittseinkommens, auf
                      das sich der Deckel bezieht:
                    </p>
                    <p>
                      <strong>4.419 € − 3.266 € = 1.353 €</strong>, die pro
                      Monat durch den Deckel an den Sozialfonds, Fraktionsverein
                      oder lokale Vereine und Projekte fließen.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Warum wollen wir einen Gehaltsdeckel für unsere
                    Abgeordneten?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Wir glauben: Unsere Politiker*innen sollten nicht mehr als
                      Durchschnittsbürger*innen verdienen, um möglichst nah an
                      der Lebensrealität der arbeitenden Menschen zu bleiben,
                      für die unsere Partei Politik macht.
                    </p>
                    <p>
                      Ein Gehaltsdeckel stärkt unsere Glaubwürdigkeit: Im
                      Kleinen leben, was man für das Große will (Solidarität und
                      Umverteilung von oben). Durch die Weitergabe des Geldes in
                      einen Sozialfonds können wir konkrete Hilfe im Alltag der
                      Menschen leisten und bleiben mit unserer Klasse und der
                      Bevölkerung außerhalb der Parlamente verbunden.
                    </p>
                    <p>
                      Wir verstehen ein Mandat nicht als Karrierebooster oder
                      Selbstzweck, sondern unsere Abgeordneten und Vertretungen
                      im Parlament sind ein Teil unserer Strategie, um eine
                      andere Gesellschaft aufzubauen und zu erkämpfen. Wenn die
                      Logik der Parlamente unsere Abgeordnete von der
                      arbeitenden Bevölkerung entfernt und im politischen
                      Mikrokosmos festhält, sehen wir es als Aufgabe unserer
                      Partei dem entgegenzuwirken.
                    </p>
                    <p>
                      Der Gehaltsdeckel ist Teil unserer Strategie gegen den
                      Aufstieg der AfD: Viele Menschen sind frustriert von der
                      Politik und den politischen Prozessen, denen sie
                      ausgesetzt sind. Sie wenden sich von der etablierten
                      Politik ab und stecken ihre Hoffnung auf Veränderung u.a.
                      in rechtsradikale Parteien. Durch den Gehaltsdeckel können
                      wir uns von den anderen Parteien abgrenzen und klar
                      machen, dass wir es ernst damit meinen, Politik anders
                      machen zu wollen. Laut Umfragen spricht sich eine
                      deutliche Mehrheit der Bevölkerung für eine Begrenzung der
                      Abgeordnetendiäten aus und insbesondere die Wähler*innen
                      der AfD (~80 % Zustimmung und damit der höchste Wert).
                    </p>
                    <p>
                      Und die Linke wäre mit einem Gehaltsdeckel nicht allein:
                      in vielen anderen europäischen Linksparteien deckeln die
                      Abgeordneten ihre Gehälter, z.B. bei der KPÖ aus
                      Österreich, der belgischen PTB, die sozialistische Partei
                      Irlands (Socialist Party) oder der niederländischen
                      sozialistischen Partei SP (Socialistische Partij).
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Was hat ein Abgeordneter aktuell monatlich zur Verfügung?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      MdBs stehen monatlich ca. 18.300 Euro zur Verfügung. Diese
                      teilen sich wie folgt auf:
                    </p>

                    <p>
                      <strong>1. Abgeordnetenentschädigung (Diäten)</strong>
                    </p>
                    <ul>
                      <li>
                        <strong>Höhe:</strong> Seit dem 1. Juli 2025 beträgt die
                        monatliche Abgeordnetenentschädigung 11.833 Euro brutto.
                      </li>
                      <li>
                        <strong>Besteuerung:</strong> Diese Entschädigung ist
                        einkommenssteuerpflichtig, jedoch sind keine Beiträge
                        zur Sozialversicherung wie Renten- oder
                        Arbeitslosenversicherung zu entrichten.
                      </li>
                      <li>
                        <strong>Kranken- und Pflegeversicherung:</strong> Der
                        Bund übernimmt die Hälfte der Beiträge. Zusätzlich
                        besteht die Möglichkeit, sich über die Beihilferegelung
                        nach Beamtenrecht zu versichern — günstiger als jede
                        gesetzliche Krankenversicherung (GKV). Da die Beiträge
                        an der Beitragsbemessungsgrenze gedeckelt sind, zahlen
                        Abgeordnete auf den größten Teil ihrer Diät ohnehin
                        keine GKV-Beiträge.
                      </li>
                      <li>
                        Mandatsträgerabgabe in Höhe von 15 Prozent der
                        Brutto-Diät an die Partei und zusätzlich eine Abgabe an
                        die Landesverbände (z.B. 5 % in Sachsen).
                      </li>
                      <li>Der Deckel greift erst nach diesen Abzügen (!)</li>
                    </ul>

                    <p>
                      <strong>2. Kostenpauschale</strong>
                    </p>
                    <ul>
                      <li>
                        Abgeordnete erhalten zusätzlich monatlich eine
                        steuerfreie Kostenpauschale von 5.467 Euro.
                      </li>
                      <li>
                        Diese Pauschale dient zur Deckung mandatsbedingter
                        Ausgaben, darunter: Unterhalt und Ausstattung von
                        Wahlkreisbüros, Fahrten in den Wahlkreis etc. Die
                        meisten MdBs zahlen daraus auch andere mandatsbezogene
                        Aufwendungen, wie etwa den Kaffee in der Pause oder auch
                        mal ein Mittagessen.
                      </li>
                      <li>
                        Die Verwendung dieser Pauschale muss keiner Verwaltung
                        oder dem Finanzamt nachgewiesen werden.
                      </li>
                      <li>
                        Der Antrag des Parteivorstands verpflichtet die
                        Abgeordneten, diese Pauschalen für politische Arbeit zu
                        verwenden und Transparenz über die Verwendung
                        herzustellen.
                      </li>
                    </ul>

                    <p>
                      <strong>3. Amtsausstattung (Büro und Technik)</strong>
                    </p>
                    <ul>
                      <li>
                        Jede*r Abgeordnete erhält ein eingerichtetes Büro am
                        Sitz des Deutschen Bundestages in Berlin.
                      </li>
                      <li>
                        Zusätzlich steht ein jährliches Budget von 12.000 Euro
                        für Bürobedarf und technische Ausstattung der MdBs und
                        Mitarbeiter*innen zur Verfügung. Damit werden
                        Kaffeemaschinen, Handys inkl. Verträge und Laptops inkl.
                        Betriebssystem finanziert. Außerdem haben MdBs noch eine
                        Mitarbeiter*innenpauschale zur Beschäftigung von
                        Mitarbeiter*innen. Dafür steht ihnen monatlich ein
                        Betrag von 28.696 Euro zur Verfügung.
                      </li>
                    </ul>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Welche weiteren Privilegien gibt es für die MdBs?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      <strong>1. Altersversorgung</strong>
                    </p>
                    <ul>
                      <li>
                        Abgeordnete erwerben mit ihrer Tätigkeit Ansprüche auf
                        eine Altersversorgung, deren Höhe von der Dauer der
                        Mandatsausübung abhängt. Ein*e Abgeordnete*r erwirbt pro
                        Jahr der Mitgliedschaft einen Anspruch von 2,5 % der
                        Diäten – nach einer vollen Legislaturperiode also rund
                        1.183 Euro monatlich.³
                      </li>
                      <li>
                        Nach zwei Legislaturperioden (8 Jahre) im Deutschen
                        Bundestag hat ein*e Abgeordnete*r also bereits einen
                        monatlichen Anspruch auf ca. 2.366,69 € brutto. Sie
                        zahlen nicht in die gesetzliche Rente ein.
                      </li>
                    </ul>

                    <p>
                      <strong>2. Übergangsgeld</strong>
                    </p>
                    <ul>
                      <li>
                        Ausscheidende Bundestagsabgeordnete erhalten
                        Übergangsgeld in Höhe ihrer letzten monatlichen
                        Entschädigung (aktuell 11.833,47 €), maximal für 18
                        Monate. Der Anspruch richtet sich nach der Dauer der
                        Parlamentszugehörigkeit (ein Monat Übergangsgeld pro
                        Jahr Mandatszeit).
                      </li>
                      <li>
                        Nach zwei Wahlperioden haben ausscheidende Abgeordnete
                        also Anspruch auf 8 Monate Übergangsgeld; das sind
                        insgesamt 94.664 Euro. Die Zahlungen sind
                        steuerpflichtig und werden ab dem zweiten Monat mit
                        anderen Einkünften verrechnet.
                      </li>
                      <li>
                        Da sie keine MdBs mehr sind, greift hier auch kein
                        Gehaltsdeckel mehr.
                      </li>
                    </ul>

                    <p>
                      <strong>3. Reisekosten / Bahncard 100</strong>
                    </p>
                    <ul>
                      <li>
                        Abgeordnete haben eine Bahncard 100 für Fahrten
                        innerhalb Deutschlands und können mandatsbedingte
                        Inlandsflugkosten erstattet bekommen.
                      </li>
                      <li>
                        Für Berlin steht der kostenfreie Fahrdienst des
                        Bundestags zur Verfügung.
                      </li>
                    </ul>
                    <ul className="faq-footnotes">
                      <li>
                        ³ Pro vollem Jahr im Parlament erwerben die MdBs einen
                        Rentenanspruch von 295,83 Euro.
                      </li>
                    </ul>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Es gibt ein Gutachten vom wissenschaftlichen Dienst des
                    Bundestages zum Gehaltsdeckel. Was steht da drin? Ist der
                    Gehaltsdeckel rechtssicher?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Ein Abgeordneter unserer Bundestagsfraktion hat ein
                      Gutachten beim wissenschaftlichen Dienst des Bundestags
                      zur Rechtmäßigkeit des Gehaltsdeckels in Auftrag gegeben.
                      Er selbst hält den Deckel für verfassungswidrig.
                    </p>
                    <p>
                      Leider geht das Gutachten von falschen Grundannahmen aus,
                      so wird eine pauschale Deckelung in Höhe von 2.850 Euro
                      netto angenommen und von einer rechtlichen Verbindlichkeit
                      des Gehaltsdeckels durch eine entsprechende Änderung der
                      Satzungs- bzw. Finanzordnung. Beides ist falsch: Der
                      Vorschlag des Parteivorstands landet bei mindestens 3.250
                      Euro netto monatlich und er enthält keinen rechtlichen
                      Zwang, das Geld tatsächlich abzuführen, sondern lediglich
                      eine politisch-moralische Verpflichtung an die
                      Abgeordneten dem Beschluss zu folgen.
                    </p>
                    <p>
                      Der Gehaltsdeckel nach Vorschlag des Parteivorstands ist
                      kein Satzungs- oder Finanzordnungsänderungsantrag und ist
                      damit nicht durch die Partei einklagbar. Abgeordnete
                      könnten im Falle der Nicht-Einhaltung dieser
                      Selbstverpflichtung nur sanktioniert werden, indem sie bei
                      künftigen Wahlen nicht mehr aufgestellt werden, das ist im
                      politischen Betrieb jedoch alltäglich. Das Gutachten
                      verbietet es den Mandatsträger*innen also nicht, ihr
                      Gehalt zu deckeln und das Geld abzuführen.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Hätte ein MdB mit dem Gehaltsdeckel weniger zur Verfügung
                    als ein*e Arbeiter*in oder die eigenen Mitarbeiter*innen?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Nein, zwar kommen manche Facharbeiter*innen, etwa in der
                      Autoindustrie und auch manche Referent*innen in der
                      Bundestagsfraktion bei einer Vollzeitbeschäftigung auf
                      höhere Nettoeinkommen.
                    </p>
                    <p>
                      Aber, das „Netto" nach einem Gehaltsdeckel ist nicht
                      gleich dem „Netto" eine*r Facharbeiter*in. Abgeordnete
                      haben neben ihrer Diät zusätzlich noch die Kostenpauschale
                      von 5.467 Euro pro Monat zur Verfügung, aus der
                      mandatsbezogene Aufwendungen geleistet werden können, wozu
                      auch mal ein Kaffee in der Mittagspause, ein Abendessen
                      oder die Fahrradreparatur zählt.
                    </p>
                    <p>
                      Hinzukommt die Bahncard 100 und die Ansprüche auf
                      Altersvorsorge, von denen normale Arbeitnehmer*innen nur
                      träumen können. Nach Berechnungen des wissenschaftlichen
                      Dienstes des Bundestags erwerben MdBs bereits nach einer
                      Legislatur Rentenansprüche, für die eine durchschnittlich
                      verdienende Person in Vollzeit 28 Jahre arbeiten müsste.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Bleibt mit dem Gehaltsdeckel noch genug Geld für die lokale
                    Parteiarbeit übrig oder fließt dann alles in den
                    Sozialfonds?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Die Abgeordneten müssen weiterhin ihre
                      Mandatsträgerabgaben in voller Höhe leisten. Das Geld
                      fließt an die jeweiligen Landesverbände und kann für den
                      weiteren Parteiaufbau vor Ort verwendet werden.
                    </p>
                    <p>
                      Darüber hinaus sind die Abgeordneten aus unserer Sicht
                      dazu angehalten, mit ihren Ressourcen eine organisierende
                      Wahlkreisarbeit vor Ort zu gewährleisten, um die
                      Verankerung unserer Partei in den Kiezen, Vereinen und
                      Betrieben zu stärken.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Es gibt einen Änderungsantrag aus NRW, der eine Deckelung
                    der Gehälter an einen Tarifvertrag binden will. Was hat es
                    damit auf sich?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Der Landesvorstand in NRW beantragt eine Gehaltsdeckelung,
                      die sich an dem Tarifvertrag der Partei orientiert und
                      schlägt eine Eingruppierung in die Entgeltgruppe 8 vor,
                      was rund 6.000 Euro brutto entspricht. Das wären bei
                      Steuerklasse 1 ohne Kinder rund 3.700 Euro netto.
                      Weiterhin soll alles, was über dem Deckel liegt, nicht in
                      einen Sozialfonds fließen, sondern in den Fraktionsverein
                      der Linken im Bundestag. Die Bestimmungen sollen erst ab
                      der nächsten Legislatur gelten, d.h. nicht für die
                      jetzigen Abgeordneten.
                    </p>
                    <p>
                      Wir glauben das ist der falsche Weg: Der Sinn eines
                      Gehaltsdeckels geht in zwei Richtungen:
                    </p>
                    <p>
                      <strong>Erstens,</strong> müssen sozialistische
                      Abgeordnete an die Lebensrealität der arbeitenden Klasse
                      gebunden werden, da ihre materiellen Lebensverhältnisse
                      sie sonst von der Klasse entfremden können und somit auch
                      ihre Politik. Es ist also ein wichtiger Faktor, die
                      Deckelung tatsächlich so nah wie möglich an den
                      Durchschnittslöhnen zu orientieren, dabei geht es nicht
                      nur um öffentliche Kommunikation. Ein monatliches
                      Bruttogehalt von 6.000 Euro und mehr verdienen ca. 26
                      Prozent der Bevölkerung. Es hat also mit der
                      Lebensrealität von mind. 74 Prozent der Menschen nichts zu
                      tun. Das ist nicht der Sinn eines Gehaltsdeckels.
                    </p>
                    <p>
                      <strong>Zweitens,</strong> geht es um eine politische
                      Kommunikation, die vor allem bei Menschen verfängt, die
                      gegen das politische Establishment und Parteien sind, die
                      politisch frustriert sind. Als Linke anders sein zu wollen
                      als alle anderen Parteien, muss mit konkreten Handlungen
                      vor allem unserer Abgeordneten einhergehen. Die zu hohen
                      Gehälter der Parlamentarier*innen nicht nur zu
                      kritisieren, sondern zu deckeln und damit Geld in
                      gemeinwohlorientierte Arbeit zu geben, die wiederum von
                      Genoss*innen vor Ort zur Verankerung der Linken betrieben
                      werden, schafft Glaubwürdigkeit.
                    </p>
                    <p>
                      Dementsprechend ist die Abgabe der gedeckelten Gelder
                      ausschließlich in den Fraktionsverein nicht sinnvoll, weil
                      dieser nicht gezielt oder strategisch in die lokale Arbeit
                      der Genoss*innen investiert und somit die organisierende
                      Arbeit nicht unterstützt. Im Gegenteil, gerade die Gelder
                      des Fraktionsvereins gehen zum Großteil ohne jegliche
                      strategische Abwägungen an soziale Projekte von Dritten,
                      anstatt die Arbeit der eigenen Partei zu stützen.
                    </p>
                    <p>
                      Die Anbindung der Abgeordneten an einen Tarifvertrag
                      klingt aus gewerkschaftlicher Sicht erstmal gut, jedoch
                      ist der Tarifvertrag ein TV, der nur die Hauptamtlichen
                      unserer Partei betrifft. Es geht hierbei nicht um
                      gemeinsame Streiks im öffentlichen Dienst, sondern um
                      Gehaltsverhandlungen der Hauptamtlichen im
                      Karl-Liebknecht-Haus. Wir halten den Vorstoß, die
                      Entwicklung der Abgeordnetengehälter an einen Tarifvertrag
                      zu koppeln, für einen diskussionswürdigen Vorschlag.
                      Allerdings sollte es ein Tarifvertrag sein, der die
                      arbeitsweltlichen Verhältnisse Deutschlands widerspiegelt.
                      Während die Mitglieder des Bundestags ihre Diäten jedes
                      Jahr um ein paar hundert Euro erhöhen, steigen die Löhne
                      normal beschäftigter Menschen meistens deutlich geringer.
                      Das ist die tarifliche Wirklichkeit, an die wir
                      Abgeordnete binden sollten.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Es gibt einen Änderungsantrag aus Thüringen, der den
                    Gehaltsdeckel in der Satzung verankern und die Entscheidung
                    darüber auf den Parteitag im Jahr 2027 verschieben will.
                    Warum ist das keine gute Idee?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Der Landesvorstand in Thüringen hat die Rücknahme des
                      Antrags des Parteivorstands und die Einleitung eines
                      Satzungsprozesses beantragt. Der Antrag wird auch von den
                      Landesvorständen in Sachsen und Sachsen-Anhalt
                      unterstützt.
                    </p>
                    <p>
                      Der Gehaltsdeckel kann jedoch nicht in der Satzung
                      verankert werden, da er dann juristisch bindend und durch
                      die Partei einklagbar wäre. Ein Gehaltsdeckel würde damit
                      in die grundgesetzlich geschützte Freiheit des Mandats
                      eingreifen. Dieser Antrag ist also ein Manöver, um unter
                      dem Anschein von Prozesskritik die Entscheidung über den
                      Gehaltsdeckel abzuwenden.
                    </p>
                    <p>
                      Wir wollen aber auch gar keine Umsetzung des
                      Gehaltsdeckels per Gerichtsbeschluss! Mit dem Deckel
                      verhält es sich wie mit allen politischen Positionen, die
                      in unserer Partei beschlossen werden. Du kannst keinen
                      Abgeordneten zwingen, sich daran zu halten. Wir setzen auf
                      die politische Erneuerung unserer Partei von unten durch
                      eine gemeinsam gelebte Praxis, deshalb wird die Basis in
                      den Kreis- und Landesverbänden auch nach einem
                      erfolgreichen Beschluss die Einhaltung des Deckels
                      einfordern und kontrollieren müssen.
                    </p>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Gibt es Landesverbände, die bereits Gehaltsdeckel für
                    Abgeordnete vorsehen?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Ja, es gibt Regelungen in Baden-Württemberg,
                      Schleswig-Holstein und Berlin.
                    </p>

                    <p>
                      <strong>Schleswig-Holstein:</strong>
                    </p>
                    <ul>
                      <li>
                        Der Landesverband hat einen Gehaltsdeckel von 2850 Euro
                        netto beschlossen. Es gibt eine Härtefallregelung,
                        Zuschläge für Betreuungskosten, Pflege von Angehörigen
                        und Alleinerziehende.
                      </li>
                    </ul>

                    <p>
                      <strong>Baden-Württemberg:</strong>
                    </p>
                    <ul>
                      <li>
                        Der Landesparteitag hat eine Deckelung der Gehälter für
                        die Landtagsabgeordneten beschlossen, die einen
                        Gehaltsdeckel von 2950 Euro netto sowie
                        Härtefallregelung, Zuschläge für Betreuungskosten für
                        Kinder und pflegende Angehörige vorgesehen hätten.
                      </li>
                    </ul>

                    <p>
                      <strong>Berlin:</strong>
                    </p>
                    <ul>
                      <li>
                        Der Landesparteitag hat eine Deckelung der Gehälter im
                        Rahmen einer Mandatsträgervereinbarung für die künftigen
                        Abgeordneten beschlossen, die eine Anlehnung an ein
                        Grundlehrer*innengehalt (ca. 3.000 € netto) vorsieht. Es
                        gibt Zuschläge für Kinder und pflegende Angehörige von
                        200 € pro Kind/Person und max. 500 € und eine
                        Härtefallregelung.
                      </li>
                      <li>
                        Die Kandidierenden verpflichten sich, monatlich
                        mindestens 300 Euro in einen Solidaritätsfonds
                        einzuzahlen und über Nebentätigkeiten und -einkünfte
                        vollständige Transparenz herzustellen.
                      </li>
                    </ul>
                  </div>
                </details>

                <details className="faq-item">
                  <summary className="faq-q">
                    Gibt es bereits Abgeordnete, die deckeln?
                  </summary>
                  <div className="faq-answer">
                    <p>
                      Ja! Neben unseren beiden Vorsitzenden Jan van Aken und
                      Ines Schwerdtner deckelt auch Luigi Pantisano als Bewerber
                      um den Parteivorsitz an der Seite von Ines sein Gehalt.
                    </p>
                    <p>
                      Daneben sind uns folgende Abgeordnete im Bundestag
                      bekannt, die ebenfalls ihre Gehälter deckeln: Ferat Koçak,
                      Luke Hoss, Isabelle Vandre, Tamara Mazzi, Vinzenz Glaser,
                      Fabian Fahl, Anne Zerr und Stella Merendino.
                    </p>
                    <p>
                      Auch in den Landesparlamenten deckeln einige Abgeordnete,
                      darunter Nam Duy Nguyen aus Leipzig und Niklas Schenker
                      aus Berlin.
                    </p>
                  </div>
                </details>
              </div>
            </div>
  );
}
