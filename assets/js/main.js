const year = new Date().getFullYear();
const slides = Array.from(document.querySelectorAll("[data-frog-slide]"));
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const shuffle = (items) => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

const setSlideActive = (slide, isActive) => {
  slide.classList.toggle("is-active", isActive);
  slide.setAttribute("aria-hidden", isActive ? "false" : "true");
};

if (slides.length > 0) {
  let order = shuffle(slides.map((_, index) => index));
  let orderIndex = 0;
  let activeIndex = order[0] ?? 0;

  slides.forEach((slide, index) => {
    setSlideActive(slide, index === activeIndex);
    const img = slide.querySelector("img");
    if (img?.decode) {
      img.decode().catch(() => {});
    }
  });

  if (slides.length > 1 && !prefersReducedMotion.matches) {
    window.setInterval(() => {
      const current = slides[activeIndex];
      orderIndex += 1;
      if (orderIndex >= order.length) {
        order = shuffle(order);
        orderIndex = 0;
      }

      let nextIndex = order[orderIndex];
      if (nextIndex === activeIndex && order.length > 1) {
        orderIndex = (orderIndex + 1) % order.length;
        nextIndex = order[orderIndex];
      }
      const next = slides[nextIndex];

      setSlideActive(next, true);
      setSlideActive(current, false);
      activeIndex = nextIndex;
    }, 7000);
  }
}

console.info(`Template loaded (${year}).`);
