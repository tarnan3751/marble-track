const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), score: $('score'), timer: $('timer'), gems: $('gems'), lives: $('lives'),
      speedbar: $('speedbar'), speedval: $('speedval'), dist: $('dist'), msg: $('msg'), toast: $('toast'),
      title: $('title'), best: $('best'), gameover: $('gameover'), pause: $('pause'),
      goTitle: $('go-title'), goScore: $('go-score'), goDist: $('go-dist'), goGems: $('go-gems'), goGoals: $('go-goals'), goBest: $('go-best'),
    };
    this.msgTimer = 0;
    this.toastTimer = 0;
  }

  showTitle(best) {
    this.el.title.classList.remove('hidden');
    this.el.best.textContent = best > 0 ? `Best score: ${best}` : '';
  }
  hideTitle() { this.el.title.classList.add('hidden'); }
  showHud() { this.el.hud.classList.remove('hidden'); }
  hideHud() { this.el.hud.classList.add('hidden'); }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }

  showGameOver(title, stats, best, isNewBest) {
    const e = this.el;
    e.goTitle.textContent = title;
    e.goScore.textContent = stats.score;
    e.goDist.textContent = `${Math.round(stats.dist)} m`;
    e.goGems.textContent = stats.gems;
    e.goGoals.textContent = stats.goals;
    e.goBest.textContent = isNewBest ? 'New best score!' : `Best score: ${best}`;
    e.gameover.classList.remove('hidden');
  }
  hideGameOver() { this.el.gameover.classList.add('hidden'); }

  message(text, seconds = 1.2) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('show');
    this.msgTimer = seconds;
  }
  toast(text, seconds = 1.0) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('show');
    void this.el.toast.offsetWidth;
    this.el.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  update(dt, s) {
    const e = this.el;
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) e.msg.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) e.toast.classList.remove('show'); }
    e.score.textContent = s.score;
    e.timer.textContent = Math.max(0, s.time).toFixed(1);
    e.timer.classList.toggle('low', s.time < 10);
    e.gems.textContent = s.gems;
    e.lives.textContent = '●'.repeat(Math.max(0, s.lives)) + '○'.repeat(Math.max(0, 3 - s.lives));
    e.speedbar.style.width = `${Math.min(100, (s.speed / 45) * 100)}%`;
    e.speedval.textContent = Math.round(s.speed * 3.6);
    e.dist.textContent = `${Math.round(s.dist)} m`;
  }
}
