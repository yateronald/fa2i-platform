import styles from './BrandingHeader.module.css';

export default function BrandingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.logoContainer}>
        <img
          src="/fa2i-logo.jpg"
          alt="FA2I - Fédération des Associations Ivoiriennes en Inde"
          className={styles.logo}
        />
      </div>
      <h1 className={styles.title}>
        Fédération des Associations Ivoiriennes en Inde
      </h1>
      <p className={styles.tagline}>Dans l&apos;union, nous impacterons</p>
    </header>
  );
}
