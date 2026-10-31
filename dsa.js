(() => {
  const date = document.querySelector('#dsa-date');
  if (date) date.textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
})();
