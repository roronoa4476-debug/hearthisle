// Preview page: play each game sound with a label saying when it is used.
import { createSound } from './sound.js';

const SOUNDS = [
  ['dice', 'Dice roll', 'Someone rolls the dice.'],
  ['turn', 'Your turn', 'It becomes your turn (or your opening placement).'],
  ['gain', 'Resources · 1 card', 'You collect 1 card (from a roll, or your second opening settlement).', 1],
  ['gain', 'Resources · 2 cards', 'You collect 2 cards: a short card rattle.', 2],
  ['gain', 'Resources · 3 cards', 'You collect 3 cards: a longer rattle.', 3],
  ['gain', 'Resources · 4+ cards', 'You collect 4 or more cards: the longest rattle.', 4],
  ['road', 'Road', 'Anyone builds a road.'],
  ['build', 'Settlement', 'Anyone builds a settlement.'],
  ['city', 'City', 'Anyone upgrades a settlement to a city.'],
  ['card', 'Development card', 'Anyone buys a development card.'],
  ['trade', 'Trade', 'A trade with the bank, a harbour or a player goes through.'],
  ['offer', 'Trade offer', 'Another player offers you a trade.'],
  ['robber', 'Robber', 'The robber moves to a new tile.'],
  ['tick', 'Timer tick', 'Each of the last 10 seconds when the turn timer is waiting on you.'],
  ['timeout', 'Out of time', 'The turn timer runs out for someone.'],
  ['win', 'Victory', 'Someone wins the game.'],
];

const sound = createSound();
const list = document.getElementById('sound-list');
for (const [name, label, when, detail] of SOUNDS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small';
  button.textContent = `▶ ${label}`;
  // Audio unlocks on the first press, so play just after it.
  button.addEventListener('click', () => setTimeout(() => sound.play(name, detail), 30));
  const text = document.createElement('p');
  text.append(label, Object.assign(document.createElement('small'), { textContent: when }));
  const item = document.createElement('li');
  item.append(button, text);
  list.append(item);
}
