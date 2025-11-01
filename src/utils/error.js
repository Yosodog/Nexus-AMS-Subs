function formatAxiosError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.response) {
    const {status, statusText, data} = error.response;
    const details = typeof data === 'string' ? data : JSON.stringify(data);
    const truncatedDetails =
      typeof details === 'string' && details.length > 500
        ? `${details.slice(0, 500)}…`
        : details;
    return `HTTP ${status} ${statusText || ''} - ${truncatedDetails}`.trim();
  }

  if (error.request) {
    return 'No response received from remote server';
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {formatAxiosError};
