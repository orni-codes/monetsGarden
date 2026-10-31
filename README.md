# Monet's Garden

<p align="center">
  <i>A little garden that comes alive with every interaction.</i>
</p>

<p align="center">
  An interactive ASCII flower garden built as a lightweight desktop widget using Electron, HTML, CSS, and JavaScript.
</p>

---

## Overview

**Monet's Garden** is a creative desktop widget that transforms traditional ASCII flower art into a living, interactive garden.

Inspired by the simplicity of terminal-based art and the beauty of blooming flowers, the project explores how simple text characters can create expressive visual experiences.

Instead of displaying static ASCII illustrations, the goal is to bring flowers to life through animated blooming, closing, gentle movement, and cursor-based interactions.

## Features

- **ASCII Flower Art** — Retains the distinctive charm of character-based botanical illustrations.
- **Animated Blooming** — Flowers transition between closed-bud and fully bloomed states.
- **Cursor Interaction** — Flowers respond to cursor proximity, creating an interactive garden experience.
- **Organic Movement** — Subtle stem swaying and leaf animations add life to the garden.
- **Individual Flower Behaviour** — Different flower designs and animation timings create a more natural environment.
- **Desktop Experience** — Designed to run as a lightweight Electron desktop widget.

*Note: Features are being implemented progressively as the project develops.*

## Tech Stack

| Technology | Purpose |
|---|---|
| Electron | Desktop application framework |
| HTML5 | Application structure |
| CSS3 | Styling and visual animations |
| JavaScript | Interaction and animation logic |
| Git & GitHub | Version control |

## Project Structure

```text
monetsGarden/
│
├── assets/
│   └── screenshots/
│
├── src/
│   ├── index.html
│   ├── style.css
│   └── renderer.js
│
├── main.js
├── preload.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

*The structure above illustrates the intended organization; actual filenames may vary.*

## Getting Started

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/)
- npm
- Git

### Installation

Clone the repository:

```bash
git clone https://github.com/orni-codes/monetsGarden.git
```

Navigate to the project directory:

```bash
cd monetsGarden
```

Install dependencies:

```bash
npm install
```

### Run the Application

```bash
npm start
```

If your `package.json` uses a different development script, use the corresponding npm command.

## Development Roadmap

- [x] Initial Electron desktop widget setup
- [x] ASCII flower rendering
- [ ] Animated flower blooming and closing
- [ ] Cursor-proximity detection
- [ ] Individual flower interaction
- [ ] Animated stems and leaves
- [ ] Multiple ASCII flower variations
- [ ] Global desktop cursor interaction
- [ ] Desktop customization options
- [ ] Optimized packaged desktop release

## Design Philosophy

Monet's Garden is built around a simple idea:

**Even the smallest characters can create something alive.**

The project combines minimalism, typography, animation, and interaction to create a calming digital garden that lives on your desktop.

## Contributing

Suggestions, ideas, and improvements are welcome.

If you find a bug or have an idea for a new feature, feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.