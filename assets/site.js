// Les propositions restent sur le serveur lancé avec « npm start ».
    const notes = document.querySelector('#notes');
    const proposalForm = document.querySelector('#proposalForm');
    const loginDialog = document.querySelector('#login');
    const editDialog = document.querySelector('#edit');
    let admin = false;
    let items = [];
    let editing = null;

    async function api(path, options = {}) {
      const response = await fetch('/api' + path, {
        ...options,
        headers: { 'content-type': 'application/json', ...options.headers }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Une erreur est survenue.');
      return result;
    }

    // textContent évite d'interpréter le texte d'un visiteur comme du HTML.
    function render() {
      notes.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'La caisse est vide. À vous d’écrire la première loi !';
        notes.append(empty);
        return;
      }
      items.forEach((item, index) => {
        const card = document.createElement('article');
        card.className = 'note';
        const number = document.createElement('span');
        number.className = 'num';
        number.textContent = `Proposition n° ${items.length - index}`;
        const title = document.createElement('h3');
        title.textContent = item.title;
        const body = document.createElement('p');
        body.textContent = item.body;
        const actions = document.createElement('div');
        actions.className = 'note-actions';
        const edit = document.createElement('button');
        edit.className = 'small';
        edit.type = 'button';
        edit.textContent = 'Corriger';
        edit.addEventListener('click', () => openEdit(item));
        const remove = document.createElement('button');
        remove.className = 'small danger';
        remove.type = 'button';
        remove.textContent = 'Supprimer';
        remove.addEventListener('click', () => deleteProposal(item));
        actions.append(edit, remove);
        card.append(number, title, body, actions);
        notes.append(card);
      });
    }

    async function refresh() {
      try {
        const result = await api('/proposals');
        items = result.items;
        admin = result.admin;
        document.body.classList.toggle('admin', admin);
        render();
      } catch (error) {
        notes.innerHTML = '<p class="empty">Impossible de charger les propositions. Vérifiez que le serveur est lancé avec npm start.</p>';
      }
    }

    proposalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = proposalForm.querySelector('button[type="submit"]');
      button.disabled = true;
      document.querySelector('#message').textContent = 'Envoi en cours…';
      try {
        await api('/proposals', {
          method: 'POST',
          body: JSON.stringify({
            title: document.querySelector('#title').value,
            body: document.querySelector('#body').value
          })
        });
        proposalForm.reset();
        document.querySelector('#message').textContent = 'Proposition déposée !';
        await refresh();
      } catch (error) {
        document.querySelector('#message').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    // Il n'y a pas de bouton public : Ctrl + F9 ouvre la modération.
    document.addEventListener('keydown', (event) => {
      if (!event.ctrlKey || event.key !== 'F9') return;
      event.preventDefault();
      if (admin) return;
      document.querySelector('#password').value = '';
      document.querySelector('#loginmsg').textContent = '';
      if (!loginDialog.open) loginDialog.showModal();
      document.querySelector('#password').focus();
    });

    document.querySelector('#cancelLogin').addEventListener('click', () => loginDialog.close());
    document.querySelector('#loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.querySelector('#loginbutton');
      button.disabled = true;
      document.querySelector('#loginmsg').textContent = 'Vérification…';
      try {
        await api('/login', {
          method: 'POST',
          body: JSON.stringify({ password: document.querySelector('#password').value.trim() })
        });
        loginDialog.close();
        await refresh();
      } catch (error) {
        document.querySelector('#loginmsg').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    document.querySelector('#logout').addEventListener('click', async () => {
      try {
        await api('/logout', { method: 'POST' });
        await refresh();
      } catch (error) {
        alert(error.message);
      }
    });

    function openEdit(item) {
      editing = item;
      document.querySelector('#editTitle').value = item.title;
      document.querySelector('#editBody').value = item.body;
      document.querySelector('#editmsg').textContent = '';
      editDialog.showModal();
    }

    document.querySelector('#cancelEdit').addEventListener('click', () => editDialog.close());
    document.querySelector('#editForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!editing) return;
      const button = document.querySelector('#savebutton');
      button.disabled = true;
      try {
        await api('/proposals/' + editing.id, {
          method: 'PUT',
          body: JSON.stringify({
            title: document.querySelector('#editTitle').value,
            body: document.querySelector('#editBody').value
          })
        });
        editDialog.close();
        editing = null;
        await refresh();
      } catch (error) {
        document.querySelector('#editmsg').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    async function deleteProposal(item) {
      if (!confirm('Supprimer définitivement cette proposition ?')) return;
      try {
        await api('/proposals/' + item.id, { method: 'DELETE' });
        await refresh();
      } catch (error) {
        alert(error.message);
      }
    }

    // Date et heure de Paris. L'affichage dépend de l'horloge du visiteur.
    const electionDeadline = new Date('2027-05-02T20:00:00+02:00').getTime();
    const countdown = document.querySelector('#countdown');
    const electionEnd = document.querySelector('#electionEnd');

    function updateElectionClock() {
      const remaining = electionDeadline - Date.now();
      if (remaining <= 0) {
        electionEnd.hidden = false;
        countdown.hidden = true;
        return;
      }
      electionEnd.hidden = true;
      countdown.hidden = false;
      const days = Math.floor(remaining / 86400000);
      const hours = Math.floor(remaining / 3600000) % 24;
      const minutes = Math.floor(remaining / 60000) % 60;
      const seconds = Math.floor(remaining / 1000) % 60;
      countdown.querySelector('strong').textContent =
        `${days} j ${String(hours).padStart(2, '0')} h ` +
        `${String(minutes).padStart(2, '0')} min ${String(seconds).padStart(2, '0')} s`;
    }

    refresh();
    updateElectionClock();
    setInterval(updateElectionClock, 1000);
