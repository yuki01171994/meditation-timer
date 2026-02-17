const minutesSelect = document.getElementById('minutes');
const secondsSelect = document.getElementById('seconds');
const display = document.getElementById('display');

const startButton = document.getElementById('start');
const pauseButton = document.getElementById('pause');
const endButton = document.getElementById('end');

let totalSeconds = 0;
let remainingSeconds = 0;
let timerId = null;

function pad(value) {
  return String(value).padStart(2, '0');
}

function updateDisplay(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  display.textContent = `${pad(mins)}:${pad(secs)}`;
}

function buildOptions(select, start, end, step) {
  for (let value = start; value <= end; value += step) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = pad(value);
    select.append(option);
  }
}

buildOptions(minutesSelect, 0, 59, 1);
buildOptions(secondsSelect, 0, 55, 5);

function resetFromInputs() {
  const mins = Number(minutesSelect.value);
  const secs = Number(secondsSelect.value);
  totalSeconds = mins * 60 + secs;
  remainingSeconds = totalSeconds;
  updateDisplay(remainingSeconds);
}

minutesSelect.addEventListener('change', resetFromInputs);
secondsSelect.addEventListener('change', resetFromInputs);

startButton.addEventListener('click', () => {
  if (timerId) return;
  if (remainingSeconds <= 0) resetFromInputs();
  if (remainingSeconds <= 0) return;

  timerId = setInterval(() => {
    remainingSeconds -= 1;
    updateDisplay(Math.max(remainingSeconds, 0));

    if (remainingSeconds <= 0) {
      clearInterval(timerId);
      timerId = null;
    }
  }, 1000);
});

pauseButton.addEventListener('click', () => {
  if (!timerId) return;
  clearInterval(timerId);
  timerId = null;
});

endButton.addEventListener('click', () => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  remainingSeconds = 0;
  updateDisplay(remainingSeconds);
});

resetFromInputs();
