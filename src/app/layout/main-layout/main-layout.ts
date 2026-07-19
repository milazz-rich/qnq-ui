import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from '../../core/state/theme.service';
import { Sidebar } from '../sidebar/sidebar';

/** Guscio dell'applicazione: sidebar a tutta altezza + area contenuti instradata. */
@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Sidebar],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
})
export class MainLayout {
  private readonly themeService = inject(ThemeService);

  protected readonly theme = this.themeService.theme;
}
