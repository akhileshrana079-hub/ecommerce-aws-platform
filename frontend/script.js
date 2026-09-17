const API_URL = "http://localhost:5001";

// ==========================================
// API REQUEST HELPER
// ==========================================

async function apiFetch(url, options = {}) {
  const config = {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers || {})
    }
  };

  return fetch(url, config);
}


// ==========================================
// LOAD FILES FROM S3
// ==========================================

async function loadFiles() {

  const container =
    document.getElementById("filesContainer");

  if (!container) return;

  try {

    container.innerHTML = "Loading...";

    const response = await apiFetch(
      `${API_URL}/api/files`
    );

    // Authentication check
    if (response.status === 401 || response.status === 403) {

      container.innerHTML = `
        <p>🔐 Please login to access your S3 files.</p>
      `;

      console.warn("Authentication required");

      return;
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        data.message || "Failed to load files"
      );
    }

    if (!data.files || data.files.length === 0) {

      container.innerHTML =
        "<p>No files found in S3.</p>";

      const totalProducts =
        document.getElementById("totalProducts");

      if (totalProducts) {
        totalProducts.innerText = "0";
      }

      return;
    }

    container.innerHTML = "";

    data.files.forEach(file => {

      const div =
        document.createElement("div");

      div.className = "file-item";

      const fileName =
        document.createElement("div");

      fileName.innerHTML = `
        <div class="file-name">
          📄 ${escapeHtml(file.Key)}
        </div>

        <div class="file-size">
          ${file.Size} bytes
        </div>
      `;

      const button =
        document.createElement("button");

      button.innerText = "Download";

      button.onclick = () => {
        downloadFile(file.Key);
      };

      div.appendChild(fileName);
      div.appendChild(button);

      container.appendChild(div);

    });

    const totalProducts =
      document.getElementById("totalProducts");

    if (totalProducts) {
      totalProducts.innerText =
        data.files.length;
    }

  }

  catch (error) {

    console.error(
      "Load files error:",
      error
    );

    container.innerHTML = `
      <p>❌ Failed to load files</p>
    `;

  }

}


// ==========================================
// UPLOAD FILE TO S3
// ==========================================

async function uploadFile() {

  const input =
    document.getElementById("fileInput");

  const status =
    document.getElementById("uploadStatus");

  if (!input || !status) return;


  if (!input.files.length) {

    status.innerText =
      "❌ Please select a CSV file.";

    return;
  }


  const file =
    input.files[0];


  // Only allow CSV files
  if (
    !file.name.toLowerCase().endsWith(".csv")
  ) {

    status.innerText =
      "❌ Please select a CSV file.";

    return;
  }


  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );


  try {

    status.innerText =
      "Uploading to AWS S3...";


    const response =
      await apiFetch(
        `${API_URL}/api/files/upload`,
        {
          method: "POST",
          body: formData
        }
      );


    if (
      response.status === 401 ||
      response.status === 403
    ) {

      status.innerText =
        "❌ Authentication required. Please login first.";

      return;
    }


    const data =
      await response.json();


    if (!data.success) {

      throw new Error(
        data.message ||
        "Upload failed"
      );

    }


    status.innerText =
      `✅ ${data.filename || file.name} uploaded successfully!`;


    input.value = "";


    // Reload S3 files
    await loadFiles();

  }

  catch (error) {

    console.error(
      "Upload error:",
      error
    );

    status.innerText =
      `❌ Upload failed: ${error.message}`;

  }

}


// ==========================================
// DOWNLOAD FILE FROM S3
// ==========================================

async function downloadFile(filename) {

  try {

    const response =
      await apiFetch(
        `${API_URL}/api/files/download/${encodeURIComponent(filename)}`
      );


    if (
      response.status === 401 ||
      response.status === 403
    ) {

      alert(
        "Authentication required. Please login first."
      );

      return;
    }


    const data =
      await response.json();


    if (!data.success) {

      throw new Error(
        data.message ||
        "Download failed"
      );

    }


    if (!data.url) {

      throw new Error(
        "Download URL was not returned."
      );

    }


    // Open presigned S3 URL
    window.open(
      data.url,
      "_blank"
    );

  }

  catch (error) {

    console.error(
      "Download error:",
      error
    );

    alert(
      `Download failed: ${error.message}`
    );

  }

}


// ==========================================
// PRODUCT RANKING
// ==========================================

async function loadRanking() {

  const container =
    document.getElementById(
      "rankingContainer"
    );

  if (!container) return;


  container.innerHTML =
    "Analyzing products...";


  try {

    /*
      Personalized Product Ranking Formula

      Rating       = 40%
      Popularity   = 25%
      Purchases    = 20%
      Preference   = 15%

      Preference is currently set to 80
      as the default user preference score.
    */


    const products = [

      {
        id: 1,
        name: "Wireless Headphones",
        category: "Electronics",
        rating: 4.8,
        popularity: 90,
        purchases: 95
      },

      {
        id: 2,
        name: "Laptop",
        category: "Electronics",
        rating: 4.6,
        popularity: 85,
        purchases: 90
      },

      {
        id: 3,
        name: "Smart Watch",
        category: "Electronics",
        rating: 4.4,
        popularity: 80,
        purchases: 82
      },

      {
        id: 4,
        name: "Mechanical Keyboard",
        category: "Electronics",
        rating: 4.2,
        popularity: 75,
        purchases: 78
      },

      {
        id: 5,
        name: "Running Shoes",
        category: "Fashion",
        rating: 4.5,
        popularity: 88,
        purchases: 85
      },

      {
        id: 6,
        name: "Backpack",
        category: "Fashion",
        rating: 4.3,
        popularity: 82,
        purchases: 80
      },

      {
        id: 7,
        name: "JavaScript Book",
        category: "Books",
        rating: 4.7,
        popularity: 70,
        purchases: 72
      },

      {
        id: 8,
        name: "Python Book",
        category: "Books",
        rating: 4.6,
        popularity: 76,
        purchases: 75
      }

    ];


    // Calculate ranking score
    products.forEach(product => {

      const ratingScore =
        (product.rating / 5) * 100;


      const preferenceScore =
        80;


      product.score =
        (
          ratingScore * 0.40 +
          product.popularity * 0.25 +
          product.purchases * 0.20 +
          preferenceScore * 0.15
        );

    });


    // Sort highest score first
    products.sort(
      (a, b) =>
        b.score - a.score
    );


    // Clear previous results
    container.innerHTML = "";


    // Display ranked products
    products.forEach(
      (product, index) => {

        const div =
          document.createElement("div");


        div.className =
          "rank-item";


        div.innerHTML = `

          <div class="rank-number">
            #${index + 1}
          </div>

          <div class="product-name">
            ${escapeHtml(product.name)}
          </div>

          <div class="score">
            Score:
            ${product.score.toFixed(2)}
          </div>

        `;


        container.appendChild(div);

      }
    );

  }

  catch (error) {

    console.error(
      "Ranking error:",
      error
    );

    container.innerHTML =
      "❌ Ranking failed.";

  }

}


// ==========================================
// HTML ESCAPE
// ==========================================

function escapeHtml(value) {

  const div =
    document.createElement("div");

  div.textContent =
    value ?? "";

  return div.innerHTML;

}


// ==========================================
// PAGE INITIALIZATION
// ==========================================

document.addEventListener(
  "DOMContentLoaded",
  () => {

    console.log(
      "E-Commerce AWS Analytics loaded."
    );

    // Load S3 files
    loadFiles();

    // Generate ranking
    loadRanking();

  }
);