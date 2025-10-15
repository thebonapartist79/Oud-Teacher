// lessons.js - load and render lessons from data/lessons.json
(async function(){
  const container = document.getElementById('lessons');
  try {
    const res = await fetch('data/lessons.json', { cache: 'no-store' });
    const lessons = await res.json();

    if (!Array.isArray(lessons) || lessons.length === 0) {
      container.innerHTML = '<p>No lessons yet. Add entries to <code>data/lessons.json</code>.</p>';
      return;
    }

    for (const l of lessons) {
      const card = document.createElement('article');
      card.className = 'lesson-card';
      card.innerHTML = `
        <h3>${l.title}</h3>
        <p class="muted">${l.description ?? ''}</p>
      `;
      if (l.video?.type === 'file') {
        const v = document.createElement('video');
        v.controls = true;
        v.preload = 'metadata';
        v.src = l.video.src;
        v.width = 640;
        v.setAttribute('playsinline', '');
        card.appendChild(v);
      } else if (l.video?.type === 'youtube') {
        const iframe = document.createElement('iframe');
        iframe.width = '640';
        iframe.height = '360';
        iframe.src = `https://www.youtube.com/embed/${l.video.id}`;
        iframe.title = l.title;
        iframe.frameBorder = '0';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        card.appendChild(iframe);
      } else if (l.video?.type === 'cloudflare-stream') {
        // Cloudflare Stream embed (public UID)
        const iframe = document.createElement('iframe');
        iframe.width = '640';
        iframe.height = '360';
        iframe.src = `https://iframe.videodelivery.net/${l.video.uid}`;
        iframe.title = l.title;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        card.appendChild(iframe);
      }
      container.appendChild(card);
    }
  } catch (e) {
    container.innerHTML = '<p>Failed to load lessons. Check <code>data/lessons.json</code>.</p>';
    console.error(e);
  }
})();