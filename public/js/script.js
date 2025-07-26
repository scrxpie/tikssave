const videoInput = document.getElementById('videoUrl');
const pasteBtn = document.querySelector('.paste-btn');
const clearBtn = document.querySelector('.clear-btn');

videoInput.addEventListener('input', () => {
  if (videoInput.value.trim() !== '') {
    pasteBtn.style.display = 'none';
    clearBtn.style.display = 'inline-block';
  } else {
    pasteBtn.style.display = 'inline-block';
    clearBtn.style.display = 'none';
  }
});

function pasteLink() {
  navigator.clipboard.readText()
    .then(text => {
      videoInput.value = text;
      pasteBtn.style.display = 'none';
      clearBtn.style.display = 'inline-block';
    })
    .catch(() => alert("Clipboard access denied"));
}

function clearInput() {
  videoInput.value = '';
  pasteBtn.style.display = 'inline-block';
  clearBtn.style.display = 'none';
  document.getElementById('options').style.display = 'none';
  document.getElementById('options').innerHTML = '';
}

// fetchLinks ve diğer fonksiyonları aynen kullanabilirsin
