import React, { useMemo, useRef, useState } from "react";
import styles from "./_index.module.css";

type Video = { id: string; title: string; category: string; url: string; duration: string; };

const sampleData: Video[] = [
  { id:"1", title:"DRAK — البداية", category:"عام", url:"https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4", duration:"00:00" },
  { id:"2", title:"مشاهدة الفيديو", category:"مفضلة", url:"https://storage.googleapis.com/coverr-main/mp4/Mt_Baker.mp4", duration:"00:00" }
];

export default function Index() {
  const [videos, setVideos] = useState<Video[]>(sampleData);
  const [active, setActive] = useState<Video | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("الكل");
  const inputRef = useRef<HTMLInputElement>(null);

  const categories = ["الكل", ...Array.from(new Set(videos.map(v => v.category)))];
  const filtered = useMemo(() => videos.filter(v =>
    (category === "الكل" || v.category === category) &&
    v.title.toLowerCase().includes(query.toLowerCase())
  ), [videos, query, category]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files).filter(f => f.type.startsWith("video/")).map((f,i) => ({
      id: crypto.randomUUID(),
      title: f.name.replace(/\.[^/.]+$/, ""),
      category: "مرفوع حديثاً",
      url: URL.createObjectURL(f),
      duration: "محلي"
    }));
    setVideos(prev => [...added, ...prev]);
    if (added[0]) setActive(added[0]);
  };

  const remove = (id:string) => {
    setVideos(prev => prev.filter(v => v.id !== id));
    if (active?.id === id) setActive(null);
  };

  return (
    <main className={styles.app} dir="rtl">
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.logo}>D</span><span>DRAK</span></div>
        <div className={styles.search}><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث عن فيديو..." /></div>
        <button className={styles.upload} onClick={()=>inputRef.current?.click()}>＋ رفع فيديو</button>
        <input ref={inputRef} hidden type="file" accept="video/*" multiple onChange={e=>addFiles(e.target.files)} />
      </header>

      {active && <section className={styles.player}>
        <div className={styles.videoWrap}>
          <video src={active.url} controls autoPlay playsInline />
        </div>
        <div className={styles.playerInfo}>
          <div><span className={styles.badge}>{active.category}</span><h1>{active.title}</h1></div>
          <button className={styles.delete} onClick={()=>remove(active.id)}>حذف</button>
        </div>
      </section>}

      <section className={styles.content}>
        <div className={styles.sectionHead}>
          <div><p className={styles.kicker}>مكتبتك</p><h2>فيديوهات DRAK</h2></div>
          <div className={styles.tabs}>{categories.map(c=><button key={c} className={category===c?styles.tabActive:styles.tab} onClick={()=>setCategory(c)}>{c}</button>)}</div>
        </div>
        <div className={styles.grid}>
          {filtered.map(v => (
            <article className={styles.card} key={v.id} onClick={()=>setActive(v)}>
              <div className={styles.thumb}><video src={v.url} muted preload="metadata" /><span>▶</span></div>
              <div className={styles.cardBody}><div><h3>{v.title}</h3><p>{v.category}</p></div><button onClick={(e)=>{e.stopPropagation();remove(v.id)}} aria-label="حذف">⋮</button></div>
            </article>
          ))}
          {!filtered.length && <div className={styles.empty}>ما فيه فيديوهات مطابقة للبحث.</div>}
        </div>
      </section>
    </main>
  );
}
   79