async function dateTime() {
  const today = new Date();
  let dd = today.getDate();
  let mm = today.getMonth() + 1; // January is 0!
  const yyyy = today.getFullYear();
  let hours = today.getHours();
  let minutes = today.getMinutes();
  let seconds = today.getSeconds();
  let milliseconds = today.getMilliseconds();

  if (dd < 10) {
    dd = `0${dd}`;
  }
  if (mm < 10) {
    mm = `0${mm}`;
  }
  if (hours < 10) {
    hours = `0${hours}`;
  }
  if (minutes < 10) {
    minutes = `0${minutes}`;
  }
  if (seconds < 10) {
    seconds = `0${seconds}`;
  }
  if (milliseconds < 10) {
    milliseconds = `0${milliseconds}`;
  }
  return `${dd}-${mm}-${yyyy}-${hours}${minutes}${seconds}${milliseconds}`;
}

module.exports = { dateTime };