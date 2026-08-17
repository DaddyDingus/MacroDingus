function generateTicks(min, max) {
  const tickMin = Math.ceil(min - 1);
  const tickMax = Math.floor(max + 1);
  const range = tickMax - tickMin;
  let step = 1;
  if (range > 40) step = 10;
  else if (range > 20) step = 5;
  else if (range > 10) step = 2;
  
  const ticks = [];
  for (let i = tickMin; i <= tickMax; i += step) {
    ticks.push(i);
  }
  return ticks;
}

console.log(generateTicks(81.4, 86.2)); // Range ~ 5, step 1
console.log(generateTicks(81.4, 95.2)); // Range ~ 14, step 2
console.log(generateTicks(60, 90)); // Range ~ 30, step 5
console.log(generateTicks(50, 150)); // Range ~ 100, step 10
