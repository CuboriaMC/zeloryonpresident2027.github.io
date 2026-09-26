# Zeloryon 2027 — projet Visual Studio Code

## Démarrer

1. Décompressez le ZIP et ouvrez le dossier `zeloryon-vscode` dans Visual Studio Code.
2. Installez Node.js 20 ou plus récent si nécessaire.
3. Dans le terminal intégré, lancez `npm start`.
4. Ouvrez http://127.0.0.1:3000 dans votre navigateur. Ne lancez pas `index.html` directement et n'utilisez pas Live Server : le formulaire a besoin de `server.js`.

La modération s'ouvre avec **Ctrl + F9**. Si le navigateur intercepte cette combinaison, le raccourci peut ne pas fonctionner ; le navigateur décide en dernier ressort. Le mot de passe initial est celui communiqué dans la conversation. Le serveur conserve les post-it dans `propositions.json`, créé au premier dépôt.

## Où modifier le projet

- `index.html` : textes et structure des pages.
- `assets/site.css` : apparence, sans modifier les photos ou l'affiche.
- `assets/site.js` : formulaires, post-it, raccourci et compte à rebours.
- `server.js` : stockage, mot de passe, modération et protections réseau.
- `assets/affiche.png`, `assets/portrait.jpg`, `assets/chat.jpg` : images d'origine.

Le compte à rebours mène au 2 mai 2027 à 20 h, heure de Paris. La date est dans `assets/site.js`, variable `electionDeadline`. L'écran noir est un message fictif, sans résultat électoral officiel. Le navigateur utilise l'horloge de l'ordinateur.

## Sécurité et mise en ligne

Le serveur limite les essais de connexion à cinq échecs par adresse IP et par 15 minutes et les propositions à dix par 10 minutes. Il vérifie les données, l'origine des requêtes et les droits de modération. Les textes sont affichés avec `textContent`, et les scripts/styles sont servis séparément avec une politique de chargement restrictive. Les sessions sont aléatoires, gardées en mémoire du serveur et effacées à la déconnexion. Les post-it sont stockés en JSON : cette version n'exécute **aucune requête SQL**.

Par défaut, le serveur n'écoute que sur votre ordinateur (`127.0.0.1`). Le mot de passe initial a été partagé dans la conversation : **changez-le avant toute mise en ligne** avec la variable d'environnement `ADMIN_PASSWORD`. Pour héberger publiquement ce projet, utilisez un hébergement HTTPS, définissez `PUBLIC_ORIGIN` sur l'adresse exacte en `https://`, et prévoyez un dispositif de limitation des requêtes partagé entre instances si plusieurs serveurs tournent en parallèle. Les limites de cette version sont conservées seulement dans la mémoire du processus et repartent à zéro à son redémarrage. Les sessions aussi.

Exemple local sous PowerShell pour définir un nouveau mot de passe avant le démarrage :

```powershell
$env:ADMIN_PASSWORD = "Choisissez-un-nouveau-mot-de-passe-long"
npm start
```
