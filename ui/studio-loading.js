{
  const message = document.getElementById('studio-loading-message');

  if (message) {
    const lines = [
      message.textContent,
      'Asking the knights to stand in a straight line…',
      'Clearing the king’s calendar for castling…',
      'Reminding the rooks to stay in their lanes…',
      'Asking the queen to leave a few squares for everyone else…',
      'Getting all 64 squares on the same page…',
      'Letting the bishops take the diagonal shortcut…',
      'Giving the knights permission to jump the queue…',
      'Holding promotion interviews for the pawns…',
      'Making sure both kings showed up…',
      'Rehearsing the handshake before move one…',
      'Keeping e4 warm for the first pawn…',
      'Making room for an argument in the center…',
      'Talking the queen out of an early entrance…',
      'Protecting f7 before anyone gets ideas…',
      'The h-pawn is plotting a solo adventure…',
      'Finding a quiet corner for the king…',
      'Sorting the bishops by square color…',
      'Counting the squares. Still 64…',
      'Giving White the first word…',
      'Rehearsing “I meant to sacrifice that”…',
      'Keeping a spare tempo in our pocket…',
      'Setting the table for a knight fork…',
      'Giving the pinned pieces a moment to reflect…',
      'Looking behind the rook for a discovered attack…',
      'Counting backward from mate in three…',
      'The Sicilian Defense comes with a side of counterplay…',
      'Turning down a suspiciously free pawn…',
      'Checking the back rank before anyone sneaks in…',
      'Leaving a light on for the endgame…',
    ];
    let index = Math.floor(Math.random() * lines.length);

    function showNextLine() {
      if (!message.isConnected) return;
      message.textContent = lines[index];
      index = (index + 1) % lines.length;
      setTimeout(showNextLine, 4500);
    }

    showNextLine();
  }
}
