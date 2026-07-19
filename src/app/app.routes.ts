import { Routes } from '@angular/router';
import { Login } from './features/auth/components/login/login';
import { MainLayout } from './layout/main-layout/main-layout';
import { Dashboard } from './features/dashboard/components/dashboard/dashboard';
import { NewSession } from './features/new-session/components/new-session/new-session';
import { Sessions } from './features/sessions/components/sessions/sessions';
import { Servers } from './features/targets/components/servers/servers';
import { Clients } from './features/clients/components/clients/clients';
import { Scenarios } from './features/scenarios/components/scenarios/scenarios';
import { Results } from './features/results/components/results/results';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: MainLayout,
    children: [
      { path: '', component: Dashboard },
      { path: 'new-session', component: NewSession },
      { path: 'sessions', component: Sessions },
      { path: 'servers', component: Servers },
      { path: 'clients', component: Clients },
      { path: 'scenarios', component: Scenarios },
      { path: 'results', component: Results },
    ],
  },
];
