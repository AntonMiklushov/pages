const year = new Date().getFullYear();
const slides = Array.from(document.querySelectorAll("[data-frog-slide]"));
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const setSlideActive = (slide, isActive) => {
  slide.classList.toggle("is-active", isActive);
  slide.setAttribute("aria-hidden", isActive ? "false" : "true");
};

if (slides.length > 0) {
  let activeIndex = slides.findIndex((slide) =>
    slide.classList.contains("is-active")
  );
  if (activeIndex < 0) {
    activeIndex = 0;
  }

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
      const nextIndex = (activeIndex + 1) % slides.length;
      const next = slides[nextIndex];

      setSlideActive(next, true);
      setSlideActive(current, false);
      activeIndex = nextIndex;
    }, 7000);
  }
}

console.info(`Template loaded (${year}).`);
