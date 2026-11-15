(function () {
  const slots = ['09:30', '10:30', '14:30', '16:00', '18:15'];
  let idx = 2;
  const clock = document.getElementById('live-slot-clock');
  if (clock) {
    setInterval(() => {
      idx = (idx + 1) % slots.length;
      clock.textContent = slots[idx];
    }, 2600);
  }

  const tabs = document.querySelectorAll('.showcase-tab');
  const img = document.getElementById('showcase-img');
  const urlLabel = document.getElementById('showcase-url');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      if (img && tab.dataset.shot) {
        img.src = tab.dataset.shot;
        img.alt = `Tela real: ${tab.textContent.trim()}`;
      }
      if (urlLabel && tab.dataset.label) {
        urlLabel.textContent = tab.dataset.label;
      }
    });
  });
})();
