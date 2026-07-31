// Zamrozone odpowiedzi Sejm ELI API + podmieniony global fetch.
//
// Ladowane przez `node --import ./test/fixtures.mjs dist/index.js` - serwer MCP
// startuje normalnie po stdio, ale nie dotyka sieci. Ksztalt odpowiedzi zdjety
// z api.sejm.gov.pl 2026-07-31 (pola przyciete do tych, ktorych uzywa kod).
//
// Regula floty: HTTP 200 nie dowodzi, ze konektor zyje. Dlatego fixture zawiera
// tez przypadki, ktore ODPOWIADAJA 200, a tresci nie maja - i test ma na nie
// asercje, a nie tylko na sciezke szczesliwa.

const ART_118_JEDNOLITY =
    "Art. 118. Jezeli przepis szczegolny nie stanowi inaczej, termin przedawnienia " +
    "wynosi szesc lat, a dla roszczen o swiadczenia okresowe oraz roszczen zwiazanych " +
    "z prowadzeniem dzialalnosci gospodarczej - trzy lata.";

const ART_118_OGLOSZONY =
    "Art. 118. W stosunkach miedzy jednostkami gospodarki uspolecznionej, ktore " +
    "podlegaja panstwowemu arbitrazowi gospodarczemu, termin przedawnienia wynosi " +
    "jeden rok. W innych stosunkach termin przedawnienia wynosi lat dziesiec.";

// Wypelniacz, zeby art. 118 wypadl DALEKO za pierwsza strona 5000 znakow -
// dokladnie ta sytuacja, w ktorej stary tool zwracal spis tresci i konczyl.
function padTo(chars) {
    const unit = "<p>Art. 1. Przepis wypelniajacy tresc kodeksu.</p>\n";
    return unit.repeat(Math.ceil(chars / unit.length));
}

export const FIXTURES = {
    // Akt bazowy: HTML JEST, ale to brzmienie z 1964 r., i istnieje nowszy tekst jednolity.
    "/acts/DU/1964/93": {
        json: {
            address: "WDU19640160093",
            ELI: "DU/1964/93",
            displayAddress: "Dz.U. 1964 nr 16 poz. 93",
            title: "Ustawa z dnia 23 kwietnia 1964 r. - Kodeks cywilny.",
            type: "Ustawa",
            publisher: "DU",
            year: 1964,
            pos: 93,
            promulgation: "1964-05-18",
            status: "akt posiada tekst jednolity",
            inForce: "IN_FORCE",
            textHTML: true,
            textPDF: true,
            texts: [
                { fileName: "text.html", type: "H" },
                { fileName: "D19640093.pdf", type: "O" },
                { fileName: "D19640093Lj.pdf", type: "U" },
            ],
            references: {
                "Inf. o tekscie jednolitym": [
                    { id: "DU/2026/795" },
                    { id: "DU/2025/1071" },
                ],
            },
        },
    },
    "/acts/DU/1964/93/text.html": {
        text:
            "<html><body><h1>Kodeks cywilny</h1>\n" +
            padTo(9000) +
            `<p>${ART_118_OGLOSZONY}</p>\n` +
            padTo(3000) +
            "</body></html>",
    },

    // Obwieszczenie z tekstem jednolitym 2024: HTML jest, to brzmienie aktualne.
    "/acts/DU/2024/1061": {
        json: {
            address: "WDU20240001061",
            ELI: "DU/2024/1061",
            displayAddress: "Dz.U. 2024 poz. 1061",
            title:
                "Obwieszczenie Marszalka Sejmu z dnia 21 czerwca 2024 r. w sprawie " +
                "ogloszenia jednolitego tekstu ustawy - Kodeks cywilny",
            type: "Obwieszczenie",
            publisher: "DU",
            year: 2024,
            pos: 1061,
            promulgation: "2024-07-17",
            status: "obowiazujacy",
            inForce: "IN_FORCE",
            textHTML: true,
            textPDF: true,
            texts: [
                { fileName: "text.html", type: "H" },
                { fileName: "D20241061L.pdf", type: "T" },
            ],
            references: {
                "Tekst jednolity dla aktu": [{ id: "DU/1964/93" }],
            },
        },
    },
    "/acts/DU/2024/1061/text.html": {
        text:
            "<html><body><h1>Tekst jednolity KC</h1>\n" +
            padTo(9000) +
            `<p>${ART_118_JEDNOLITY}</p>\n` +
            padTo(3000) +
            "</body></html>",
    },

    // Obwieszczenie 2023: tekst jednolity, ale WYGASLY - tresc prawdziwa, brzmienie
    // sprzed kolejnego obwieszczenia. Druga pulapka tej samej klasy.
    "/acts/DU/2023/1610": {
        json: {
            address: "WDU20230001610",
            ELI: "DU/2023/1610",
            displayAddress: "Dz.U. 2023 poz. 1610",
            title:
                "Obwieszczenie Marszalka Sejmu z dnia 2 sierpnia 2023 r. w sprawie " +
                "ogloszenia jednolitego tekstu ustawy - Kodeks cywilny",
            type: "Obwieszczenie",
            publisher: "DU",
            year: 2023,
            pos: 1610,
            promulgation: "2023-08-14",
            status: "wygasniecie aktu",
            inForce: "NOT_IN_FORCE",
            textHTML: true,
            textPDF: true,
            texts: [{ fileName: "text.html", type: "H" }],
            references: { "Tekst jednolity dla aktu": [{ id: "DU/1964/93" }] },
        },
    },
    "/acts/DU/2023/1610/text.html": {
        text: "<html><body>" + padTo(7000) + "</body></html>",
    },

    // Obwieszczenie 2026: BRAK HTML, tylko PDF. To jest zgloszony bug.
    "/acts/DU/2026/795": {
        json: {
            address: "WDU20260000795",
            ELI: "DU/2026/795",
            displayAddress: "Dz.U. 2026 poz. 795",
            title:
                "Obwieszczenie Marszalka Sejmu z dnia 27 maja 2026 r. w sprawie " +
                "ogloszenia jednolitego tekstu ustawy - Kodeks cywilny",
            type: "Obwieszczenie",
            publisher: "DU",
            year: 2026,
            pos: 795,
            promulgation: "2026-06-17",
            status: "obowiazujacy",
            inForce: "IN_FORCE",
            textHTML: false,
            textPDF: true,
            texts: [
                { fileName: "D20260795.pdf", type: "O" },
                { fileName: "D20260795L.pdf", type: "T" },
            ],
            references: {
                "Tekst jednolity dla aktu": [{ id: "DU/1964/93" }],
            },
        },
    },

    // Akt, dla ktorego API deklaruje HTML, ale oddaje 200 z PUSTYM cialem.
    "/acts/DU/2000/999": {
        json: {
            address: "WDU20000000999",
            ELI: "DU/2000/999",
            title: "Ustawa testowa z pustym HTML",
            type: "Ustawa",
            publisher: "DU",
            year: 2000,
            pos: 999,
            status: "obowiazujacy",
            inForce: "IN_FORCE",
            textHTML: true,
            textPDF: true,
            texts: [{ fileName: "D20000999.pdf", type: "O" }],
        },
    },
    "/acts/DU/2000/999/text.html": { text: "" },
};

export const MARKERS = { ART_118_JEDNOLITY, ART_118_OGLOSZONY };

const BASE = "https://api.sejm.gov.pl/eli";

globalThis.fetch = async (url) => {
    const path = String(url).startsWith(BASE) ? String(url).slice(BASE.length) : String(url);
    const hit = FIXTURES[path];
    if (!hit) {
        return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    if (hit.json !== undefined) {
        return new Response(JSON.stringify(hit.json), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }
    return new Response(hit.text, {
        status: 200,
        headers: { "content-type": "text/html" },
    });
};
