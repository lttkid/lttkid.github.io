var posts=["2024/08/23/hello-world/","2024/08/23/page/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };