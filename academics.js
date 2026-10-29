(() => {
  const date = document.querySelector('#academic-date');
  if (date) date.textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
})();
