🇬🇧 English: [README.md](README.md)

# MyFitnessPlan

Samodzielnie hostowana lokalna aplikacja do zarządzania własnymi planami treningowymi z elastycznymi schematami harmonogramów opartymi na Twojej własnej kolekcji wideo.

## O projekcie

MyFitnessPlan to osobiste narzędzie do planowania treningów stworzone z myślą o organizowaniu i śledzeniu rutyn treningowych przy użyciu własnych materiałów wideo. W przeciwieństwie do sztywnych, tygodniowych harmonogramów, MyFitnessPlan pozwala definiować własne schematy treningowe dopasowane do Twojego stylu życia — niezależnie od tego, czy jest to 3 dni treningu i 1 dzień przerwy, czy dowolny inny układ.

## Funkcje

### Import treningów TSV/CSV
![Interfejs importu TSV/CSV](./screenshots/1.%20intro.jpg)

Łatwo importuj całą swoją bibliotekę treningów za pomocą prostych plików arkuszy kalkulacyjnych. Obsługa formatów TSV i CSV zapewnia kompatybilność z Excel, Google Sheets i innymi programami do arkuszy kalkulacyjnych.

### Dodawanie ścieżek do lokalnych multimediów
![Zarządzanie biblioteką wideo](./screenshots/5.%20video%20library.jpg)

Łącz lokalne pliki wideo z treningami bezpośrednio na swoim komputerze. Zachowujesz pełną kontrolę nad biblioteką filmów bez konieczności przesyłania czegokolwiek do chmury.

### Tworzenie wielu planów
![Zarządzanie wieloma planami](./screenshots/2.%20plans.jpg)

Twórz i zarządzaj wieloma planami treningowymi jednocześnie. Przełączaj się między różnymi rutynami kiedy chcesz — idealne rozwiązanie do zmiany intensywności lub stylu treningów.

### Elastyczne własne schematy
![Własne schematy treningowe](./screenshots/3.%20workout%20pattern.jpg)

Brak sztywno zakodowanych dni tygodnia (poniedziałek–niedziela). Definiuj własne schematy treningowe: 3 dni treningu / 1 dzień przerwy, 5 dni treningu / 2 dni przerwy lub dowolny układ dopasowany do Twojego stylu życia.

### Inteligentne rozpoznawanie treningów
![Kalendarz treningów i dashboard](./screenshots/4.%20workout%20calendar.jpg)

Aplikacja współpracuje z plikami TSV/CSV i automatycznie rozpoznaje wiele wpisów treningowych w jednym wierszu. Oznaczaj pojedyncze ćwiczenia jako ukończone i śledź postęp każdej sesji treningowej — pełna elastyczność sposobu logowania treningów.

### Personalizacja i dostosowanie
![Motywy kolorystyczne i personalizacja](./screenshots/6.%20themes.jpg)

Dostosuj aplikację do siebie dzięki personalizowanym motywom kolorystycznym i opcjom konfiguracji interfejsu.

### Dodatkowe funkcje

- **Lokalna i self-hosted**: działa całkowicie na Twoim komputerze bez zależności od chmury
- **Obsługa wielu języków**: dostępna po angielsku i polsku
- **Bez subskrypcji**: pełna kontrola nad Twoimi danymi i biblioteką treningów
- **Prywatność przede wszystkim**: wszystkie dane pozostają na Twoim komputerze

## Pierwsze kroki

### Wymagania

- Node.js (v16 lub nowszy)
- npm lub yarn

### Instalacja i uruchomienie lokalnie

1. **Sklonuj repozytorium**

```bash
git clone <repository-url>
cd WorkoutPlanner
```

2. **Zainstaluj zależności serwera**

```bash
cd server
npm install
```

3. **Zainstaluj zależności klienta**

```bash
cd ../client
npm install
```

4. **Uruchom serwer**

```bash
cd ../server
npm run dev
```

Serwer będzie działał pod:

```text
http://localhost:3000
```

5. **Uruchom klienta (w nowym terminalu)**

```bash
cd client
npm run dev
```

Klient będzie dostępny pod:

```text
http://localhost:5173
```

6. **Otwórz przeglądarkę** i przejdź pod adres wyświetlony w terminalu.

## ⚠️ Ważna informacja

**MyFitnessPlan nie dostarcza żadnych filmów treningowych, treści ani ćwiczeń.** Użytkownik jest całkowicie odpowiedzialny za pozyskiwanie własnych materiałów wideo. Aplikacja służy wyłącznie do planowania i organizacji treningów. Upewnij się, że wszystkie wykorzystywane materiały są zgodne z prawem autorskim i warunkami korzystania z usług. Nie ponoszę odpowiedzialności za sposób używania aplikacji ani za treści pozyskiwane przez użytkownika.

## Dodawanie treningów

### Import plików TSV/CSV

MyFitnessPlan obsługuje masowy import treningów z plików TSV (Tab-Separated Values) lub CSV (Comma-Separated Values).

#### Przykładowe formaty treningów

W folderze `example_workout_sheets/` znajdują się dwa przykładowe pliki TSV.

### Opcja 1: Prosty format (jedno wideo na slot)

- Plik:
  `Example workout plan - Simpler workout plan - one video per row.tsv`
- Najlepszy dla prostych harmonogramów treningowych
- Struktura:
  - Pierwsza kolumna: identyfikator tygodnia
  - Pozostałe kolumny: sloty treningowe
  - Wypełnij komórki nazwami treningów lub filmów
  - Puste komórki oznaczają dni odpoczynku

### Opcja 2: Format wielu wideo dziennie

- Plik:
  `Example workout plan - Multi-video per day.tsv`
- Najlepszy dla bardziej złożonych treningów
- Struktura:
  - Pierwszy wiersz: numer tygodnia i dni tygodnia
  - Pierwsza kolumna: typ ćwiczenia
  - Każdy dzień ma własną kolumnę
  - Użyj „—” dla dni odpoczynku

#### Jak stworzyć własny plik treningowy

1. Zacznij od przykładowego pliku z folderu `example_workout_sheets/`

2. Skorzystaj z AI:
   - ChatGPT
   - Claude
   - lub dowolnego innego narzędzia AI

Możesz:
- wkleić strukturę przykładowego pliku
- podać listę swoich treningów
- poprosić AI o wygenerowanie planu treningowego w identycznym formacie

3. Edytuj plik ręcznie w Excel, Google Sheets lub edytorze tekstowym.

4. Dostosuj harmonogram do własnych potrzeb.

#### Wymagania dotyczące plików

- Format:
  `.tsv` lub `.csv`
- **Nazwy plików wideo muszą odpowiadać nazwom treningów** w arkuszu lub być do nich bardzo podobne
- Nazwy treningów powinny odpowiadać nazwom plików wideo
- Puste komórki lub „—” oznaczają dzień odpoczynku
- Kodowanie UTF-8

#### Odpowiedzialne pozyskiwanie materiałów wideo

Musisz samodzielnie pozyskiwać własne materiały treningowe.

✅ **Dozwolone źródła:**

- własne nagrania
- darmowe materiały public domain
- treści od twórców ze zgodą na użytek prywatny
- pobrane darmowe treningi YouTube (zgodnie z regulaminem)
- legalnie zakupione materiały treningowe

❌ **Niedozwolone:**

- pirackie lub nieautoryzowane materiały premium
- komercyjne programy treningowe bez zgody
- treści łamiące regulaminy twórców

**Disclaimer:** Nie ponoszę odpowiedzialności za sposób pozyskiwania, przechowywania ani używania materiałów wideo przez użytkownika.

## Struktura projektu

```text
WorkoutPlanner/
├── client/
├── server/
└── README.md
```

## Dostępne skrypty

### Client

- `npm run dev` — uruchomienie środowiska developerskiego
- `npm run build` — build produkcyjny
- `npm run preview` — podgląd builda produkcyjnego

### Server

- `npm run dev` — uruchomienie serwera z auto-reload
- `npm run build` — kompilacja TypeScript
- `npm run start` — uruchomienie skompilowanego serwera

## Konfiguracja

Pliki konfiguracyjne:

- Client:
  `client/tsconfig.json`
  `client/vite.config.ts`
- Server:
  `server/tsconfig.json`

## Rozwiązywanie problemów

- **Port zajęty**: zmień port w konfiguracji serwera
- **Nie znaleziono ścieżek do wideo**: sprawdź poprawność ścieżek
- **Problemy z CORS**: sprawdź konfigurację serwera

## Licencja

Projekt jest objęty licencją **Non-Commercial Use License**.

### Możesz:

- używać projektu prywatnie
- modyfikować go
- udostępniać niekomercyjnie
- rozwijać projekt

### Nie możesz:

- używać projektu komercyjnie
- sprzedawać dostępu do aplikacji
- wykorzystywać projektu do generowania przychodu

### Użytek komercyjny

W celu uzyskania licencji komercyjnej skontaktuj się ze mną.

---

**Copyright © 2026 Klaudia Krzos, Big Deck IT LTD**

Więcej informacji znajduje się w pliku [LICENSE](LICENSE).

**Autor:** [Klaudia Krzos](https://www.linkedin.com/in/klaudiacreativestuff/)  
**Firma:** Big Deck IT LTD

## Support

W przypadku błędów lub propozycji funkcji utwórz issue w repozytorium.
